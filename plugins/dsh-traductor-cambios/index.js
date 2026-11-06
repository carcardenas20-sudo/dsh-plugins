// dsh-traductor-cambios — cada cambio de código explicado en lenguaje de negocio, con nivel de riesgo.
//
// Al terminar una tarea que tocó archivos, el plugin:
//   1. Reúne qué cambió (git diff contra el inicio de la tarea, o los archivos que tocó el agente).
//   2. Calcula un riesgo mínimo con reglas fijas (dinero, impuestos, login, base de datos, borrados grandes...).
//   3. Le pide al agente que lo explique para alguien que no programa, sin poder bajar ese riesgo.
//   4. Lo guarda en .cambios/CAMBIOS.md (lo más nuevo arriba) y en .cambios/registro.json.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'

export const name = 'traductor-cambios'
export const inject = ['tools', 'workingDirectory', 'systemPrompt']

const SOURCE_KIND = 'traductor-cambios'
const DIR = '.cambios'
const NIVELES = ['bajo', 'medio', 'alto']

const DEFAULTS = {
  // Temas sensibles: si aparecen en la ruta o en las líneas cambiadas, el riesgo mínimo es alto.
  temasAltos: {
    'dinero o precios': /(precio|price|valor_total|subtotal|total_|descuento|discount|tarifa|costo|cost\b|margen)/i,
    'impuestos': /(\biva\b|impuest|\btax|retenci|retefuente|\bica\b)/i,
    'pagos, facturas o cartera': /(pago|payment|factur|invoice|credito|crédito|cartera|abono|saldo|balance|cuota)/i,
    'nómina': /(nomina|nómina|payroll|salari)/i,
    'acceso y contraseñas': /(auth|login|logout|password|contrase|token|jwt|oauth|permis|\brole|rol_|admin)/i,
    'base de datos': /(migrat|schema|\.sql\b|prisma|sequelize|typeorm|alter table|drop table|create table)/i,
    'secretos o configuración': /(\.env\b|secret|api[_-]?key|credential|config\/prod)/i,
  },
  lineasBorradasMedio: 50,
  archivosMedio: 10,
  maxDiffChars: 12000,
  pedirExplicacion: true,
}

const MUTATING = /^(write|edit|apply_patch|bash|pwsh|powershell|shell|multi_edit|delete|move|create_file|notebook_edit)$|write|edit|patch/i
const FILE_TOOLS = /^(write|edit|apply_patch|multi_edit|create_file|delete|move)$/i

// ---------------------------------------------------------------- utilidades

function deepFreeze(v) { if (v && typeof v === 'object') { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v) } return v }
function notice(text, summary) {
  return deepFreeze(structuredClone({
    role: 'user', content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND, form: 'notice', summary: summary.slice(0, 120) }, id: randomUUID(),
  }))
}
const ahora = () => new Date().toISOString()
async function readJson(p, f) { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return f } }
async function writeAtomic(p, text) { const t = `${p}.${process.pid}.tmp`; await writeFile(t, text, 'utf8'); await rename(t, p) }

/** Extrae rutas de los argumentos de herramientas de archivos (write, edit, apply_patch). */
export function rutasDeArgs(args) {
  const out = new Set()
  if (!args || typeof args !== 'object') return out
  for (const k of ['file_path', 'path', 'filePath', 'target', 'source', 'destination']) if (typeof args[k] === 'string') out.add(args[k])
  const patch = typeof args.patch === 'string' ? args.patch : typeof args.input === 'string' ? args.input : ''
  for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) out.add(m[1].trim())
  for (const m of patch.matchAll(/^\+\+\+ b\/(.+)$/gm)) out.add(m[1].trim())
  return out
}

/** Analiza un diff unificado: archivos, líneas añadidas/borradas y temas sensibles. */
export function analizarDiff(diff, archivosExtra, cfg) {
  const archivos = new Map() // ruta -> { mas, menos }
  let actual
  for (const linea of (diff ?? '').split('\n')) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(linea)
    if (m) { actual = m[2]; if (!archivos.has(actual)) archivos.set(actual, { mas: 0, menos: 0 }); continue }
    if (!actual || linea.startsWith('+++') || linea.startsWith('---')) continue
    if (linea.startsWith('+')) archivos.get(actual).mas++
    else if (linea.startsWith('-')) archivos.get(actual).menos++
  }
  for (const r of archivosExtra ?? []) if (!archivos.has(r)) archivos.set(r, { mas: 0, menos: 0, sinDiff: true })
  const cambiadas = (diff ?? '').split('\n').filter((l) => /^[+-][^+-]/.test(l)).join('\n')
  const temas = []
  for (const [tema, re] of Object.entries(cfg.temasAltos)) {
    const enRuta = [...archivos.keys()].find((r) => re.test(r))
    const enCodigo = re.exec(cambiadas)
    if (enRuta || enCodigo) temas.push({ tema, evidencia: enRuta ? `archivo ${enRuta}` : `línea con "${enCodigo[0]}"` })
  }
  const menos = [...archivos.values()].reduce((a, b) => a + b.menos, 0)
  const mas = [...archivos.values()].reduce((a, b) => a + b.mas, 0)
  const razones = temas.map((t) => `toca ${t.tema} (${t.evidencia})`)
  let riesgo = temas.length ? 'alto' : 'bajo'
  if (riesgo === 'bajo' && menos >= cfg.lineasBorradasMedio) { riesgo = 'medio'; razones.push(`borra ${menos} líneas`) }
  if (riesgo === 'bajo' && archivos.size >= cfg.archivosMedio) { riesgo = 'medio'; razones.push(`toca ${archivos.size} archivos`) }
  if (razones.length === 0) razones.push('no toca temas sensibles y el cambio es acotado')
  return { archivos: [...archivos.entries()].map(([ruta, v]) => ({ ruta, ...v })), mas, menos, riesgo, razones }
}

const maxRiesgo = (a, b) => NIVELES[Math.max(NIVELES.indexOf(a), NIVELES.indexOf(b))]
const icono = { bajo: '🟢', medio: '🟡', alto: '🔴' }

// ---------------------------------------------------------------- plugin

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}), temasAltos: { ...DEFAULTS.temasAltos, ...(rawConfig?.temasAltos ?? {}) } }
  for (const [k, v] of Object.entries(cfg.temasAltos)) if (typeof v === 'string') cfg.temasAltos[k] = new RegExp(v, 'i')
  const estados = new WeakMap()
  const st = (agent) => {
    let s = estados.get(agent)
    if (!s) { s = { base: undefined, baseLista: undefined, tocados: new Set(), muto: false, pedido: false, pendiente: undefined, tarea: '' }; estados.set(agent, s) }
    return s
  }

  /** Ejecuta git directamente (sin shell): igual en Windows, macOS y Linux. Solo lectura, salvo `stash create`, que no toca tus archivos. */
  function git(args, cwd, signal) {
    return new Promise((res) => {
      execFile('git', args, { cwd, signal, timeout: 30000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: stdout ?? '', err: stderr ?? '' })
      })
    })
  }

  /** Foto del árbol de trabajo al empezar la tarea (sin modificar nada). */
  async function fotoBase(agent, signal) {
    const cwd = await ctx.workingDirectory.ensure(agent, signal)
    const repo = await git(['rev-parse', '--is-inside-work-tree'], cwd, signal)
    if (!repo || repo.code !== 0 || !repo.out.includes('true')) return { cwd, git: false }
    const stash = await git(['stash', 'create'], cwd, signal)
    let base = stash?.code === 0 ? stash.out.trim() : ''
    if (!base) { const head = await git(['rev-parse', 'HEAD'], cwd, signal); base = head?.code === 0 ? head.out.trim() : '' }
    const untracked = await git(['ls-files', '--others', '--exclude-standard'], cwd, signal)
    return { cwd, git: !!base, base, untracked: new Set((untracked?.out ?? '').split('\n').map((x) => x.trim()).filter(Boolean)) }
  }

  async function diffDesdeBase(agent, s, signal) {
    const foto = await (s.baseLista ?? fotoBase(agent, signal))
    const cwd = foto.cwd
    if (!foto.git) return { cwd, diff: '', nuevos: [...s.tocados] }
    const d = await git(['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', foto.base], cwd, signal)
    const u = await git(['ls-files', '--others', '--exclude-standard'], cwd, signal)
    const nuevos = (u?.out ?? '').split('\n').map((x) => x.trim()).filter((x) => x && !foto.untracked.has(x) && !x.startsWith(`${DIR}/`) && !x.startsWith('.entrega/'))
    const diff = (d?.out ?? '').split(/(?=^diff --git )/m).filter((b) => !/^diff --git a\/(\.cambios|\.entrega)\//.test(b)).join('')
    return { cwd, diff, nuevos: [...new Set([...nuevos, ...[...s.tocados].filter((r) => !r.startsWith(DIR))])] }
  }

  // ------------------------------------------------ inicio de tarea

  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (message?.source?.kind !== 'user') return
    const s = st(agent)
    // Si la tarea anterior quedó con un análisis sin registrar, se conserva su base.
    if (s.pendiente) return
    s.tocados = new Set(); s.muto = false; s.pedido = false
    s.tarea = (message.content ?? []).map((b) => b.text ?? '').join(' ').trim().slice(0, 200)
    s.baseLista = fotoBase(agent).catch((e) => { ctx.logger?.warn?.(`traductor: ${e?.message ?? e}`); return { cwd: undefined, git: false } })
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    try {
      if (exec.agent && !exec.name.startsWith('cambios_') && !exec.name.startsWith('entrega_') && MUTATING.test(exec.name)) {
        const s = st(exec.agent)
        s.muto = true
        if (FILE_TOOLS.test(exec.name)) for (const r of rutasDeArgs(exec.arguments)) s.tocados.add(r)
      }
    } catch { /* nunca romper el pipeline */ }
    return downstream
  })

  // ------------------------------------------------ al cerrar: pedir la traducción

  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    if (!cfg.pedirExplicacion) return
    const s = estados.get(agent)
    if (!s || !s.muto || s.pedido) return
    let datos
    try { datos = await diffDesdeBase(agent, s, signal) } catch (e) { ctx.logger?.warn?.(`traductor: ${e?.message ?? e}`); return }
    if (!datos.diff.trim() && datos.nuevos.length === 0) { s.muto = false; return }
    const analisis = analizarDiff(datos.diff, datos.nuevos, cfg)
    s.pendiente = { analisis, tarea: s.tarea }
    s.pedido = true
    const recorte = datos.diff.length > cfg.maxDiffChars ? datos.diff.slice(0, cfg.maxDiffChars) + '\n…(diff recortado)' : datos.diff
    agent.steer(notice([
      '[Traductor de cambios] Antes de terminar, llama `cambios_registrar` para dejar este cambio explicado a alguien que NO programa (dueño del negocio, cliente o jefe).',
      `Riesgo mínimo calculado: ${icono[analisis.riesgo]} ${analisis.riesgo.toUpperCase()} — ${analisis.razones.join('; ')}. Puedes subirlo, no bajarlo.`,
      `Archivos: ${analisis.archivos.map((a) => `${a.ruta} (+${a.mas}/-${a.menos})`).join(', ') || 'ninguno'}`,
      'Escribe en el idioma del usuario, sin jerga técnica: qué cambia para quien usa el sistema, qué podría salir mal y cómo comprobarlo a mano.',
      recorte ? `\nDiff:\n${recorte}` : '',
    ].join('\n'), `Explicar cambio: riesgo ${analisis.riesgo}`))
  })

  // ------------------------------------------------ herramientas

  const text = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }

  ctx.tools.register({
    name: 'cambios_registrar',
    description:
      'Registra la explicación de negocio del cambio de código que acabas de hacer, para alguien que no programa. Queda en .cambios/CAMBIOS.md. ' +
      'El riesgo nunca puede ser menor que el mínimo calculado por el plugin.',
    parameters: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título corto del cambio, en lenguaje de negocio.' },
        resumen: { type: 'string', description: 'Qué se hizo y para qué, en 1 a 3 frases sin jerga.' },
        impacto: { type: 'array', items: { type: 'string' }, description: 'Qué cambia para quien usa el sistema (pantallas, cálculos, reportes, permisos).' },
        riesgo: { type: 'string', enum: NIVELES, description: 'bajo, medio o alto.' },
        motivo_riesgo: { type: 'string', description: 'Por qué ese nivel de riesgo, en lenguaje simple.' },
        como_comprobar: { type: 'array', items: { type: 'string' }, description: 'Pasos que una persona puede hacer a mano para comprobar que funciona.' },
      },
      required: ['titulo', 'resumen', 'impacto', 'riesgo', 'motivo_riesgo', 'como_comprobar'],
    },
    output: text,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('cambios_registrar necesita una sesión de agente')
      const s = st(exec.agent)
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      let analisis = s.pendiente?.analisis
      if (!analisis) {
        const datos = await diffDesdeBase(exec.agent, s, exec.signal).catch(() => ({ diff: '', nuevos: [...s.tocados] }))
        analisis = analizarDiff(datos.diff, datos.nuevos, cfg)
      }
      const pedido = NIVELES.includes(args.riesgo) ? args.riesgo : 'medio'
      const riesgo = maxRiesgo(pedido, analisis.riesgo)
      const lista = (v) => (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
      const entrada = {
        id: randomUUID().slice(0, 8), fecha: ahora(), tarea: s.pendiente?.tarea ?? s.tarea,
        titulo: String(args.titulo ?? '').trim() || 'Cambio sin título', resumen: String(args.resumen ?? '').trim(),
        impacto: lista(args.impacto), riesgo, riesgoPropuesto: pedido, motivo: String(args.motivo_riesgo ?? '').trim(),
        razonesAutomaticas: analisis.razones, como_comprobar: lista(args.como_comprobar),
        archivos: analisis.archivos.map((a) => ({ ruta: a.ruta, mas: a.mas, menos: a.menos })),
      }
      await mkdir(join(cwd, DIR), { recursive: true })
      const reg = await readJson(join(cwd, DIR, 'registro.json'), [])
      reg.push(entrada)
      await writeAtomic(join(cwd, DIR, 'registro.json'), JSON.stringify(reg, null, 2) + '\n')
      await writeAtomic(join(cwd, DIR, 'CAMBIOS.md'), renderCambios(reg))
      s.pendiente = undefined
      s.muto = false
      const ajuste = riesgo !== pedido ? ` (propusiste "${pedido}", pero el mínimo calculado es "${analisis.riesgo}")` : ''
      return `Registrado en ${DIR}/CAMBIOS.md — ${icono[riesgo]} riesgo ${riesgo}${ajuste}. Cuéntale al usuario el resumen y el nivel de riesgo en dos o tres líneas.`
    },
  })

  ctx.tools.register({
    name: 'cambios_resumen',
    description: 'Resume los cambios registrados en los últimos días, en lenguaje de negocio y ordenados por riesgo. Úsala cuando pregunten qué cambió en el sistema o para un informe a un jefe o cliente.',
    parameters: { type: 'object', properties: { dias: { type: 'number', description: 'Cuántos días hacia atrás. Por defecto 7.' } } },
    output: text,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('cambios_resumen necesita una sesión de agente')
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const dias = Number.isFinite(args?.dias) && args.dias > 0 ? args.dias : 7
      const desde = Date.now() - dias * 864e5
      const reg = (await readJson(join(cwd, DIR, 'registro.json'), [])).filter((e) => Date.parse(e.fecha) >= desde)
      if (reg.length === 0) return `No hay cambios registrados en los últimos ${dias} días.`
      reg.sort((a, b) => NIVELES.indexOf(b.riesgo) - NIVELES.indexOf(a.riesgo) || b.fecha.localeCompare(a.fecha))
      const cuenta = Object.fromEntries(NIVELES.map((n) => [n, reg.filter((e) => e.riesgo === n).length]))
      return [`${reg.length} cambios en ${dias} días: ${cuenta.alto} 🔴 alto, ${cuenta.medio} 🟡 medio, ${cuenta.bajo} 🟢 bajo.`, '',
        ...reg.map((e) => `${icono[e.riesgo]} ${e.fecha.slice(0, 10)} — ${e.titulo}: ${e.resumen}`)].join('\n')
    },
  })

  ctx.systemPrompt.section({
    name: 'traductor-cambios', order: 2460, interpolate: false,
    text: '## Traductor de cambios\nWhen you finish a task that changed files, the harness may ask you to call `cambios_registrar` to explain the change for a non-programmer. Do it in the user\'s language, without jargon, and never claim a lower risk than the computed minimum.',
  })
}

export function renderCambios(reg) {
  const lineas = ['# Cambios del sistema', '', 'Explicados para quien no programa. Lo más reciente arriba. 🔴 alto · 🟡 medio · 🟢 bajo', '']
  for (const e of [...reg].reverse()) {
    lineas.push(`## ${icono[e.riesgo]} ${e.titulo}`, '', `*${e.fecha.slice(0, 16).replace('T', ' ')} UTC · riesgo ${e.riesgo}*`, '', e.resumen, '')
    if (e.impacto?.length) lineas.push('**Qué cambia para el usuario**', '', ...e.impacto.map((x) => `- ${x}`), '')
    lineas.push(`**Por qué este riesgo:** ${e.motivo}${e.razonesAutomaticas?.length ? ` _(detectado: ${e.razonesAutomaticas.join('; ')})_` : ''}`, '')
    if (e.como_comprobar?.length) lineas.push('**Cómo comprobarlo**', '', ...e.como_comprobar.map((x, i) => `${i + 1}. ${x}`), '')
    if (e.archivos?.length) lineas.push(`<sub>Archivos: ${e.archivos.map((a) => `${a.ruta} (+${a.mas}/-${a.menos})`).join(', ')}</sub>`, '')
  }
  return lineas.join('\n')
}
