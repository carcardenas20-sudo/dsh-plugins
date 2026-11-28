// dsh-escuadra — varios agentes escribiendo código al tiempo sin pisarse.
//
// 1. escuadra_repartir: el agente principal parte el trabajo en tareas con dueño de archivos y
//    dependencias. El plugin valida que dos tareas simultáneas no toquen lo mismo y arma oleadas.
// 2. escuadra_ejecutar: cada tarea corre en un subagente con su propia copia del repo (git worktree),
//    hasta N a la vez. Lo que un agente cambie fuera de sus archivos se descarta. Cada tarea puede
//    traer su comando de verificación y tiene un segundo intento si falla.
// 3. Al cerrar cada oleada se integran las ramas; si hay conflicto, un agente integrador lo resuelve.
//    Las tareas que dependen de otras arrancan sobre lo ya integrado.
// 4. Al final: verificación general (con un intento de reparación), revisión por un agente que no
//    participó y, si el repo no cambió mientras tanto, se aplica todo a la rama actual.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const name = 'escuadra'
export const inject = ['tools', 'subagents', 'workingDirectory', 'systemPrompt']

const DEFAULTS = {
  maxParalelo: 4, // agentes trabajando a la vez (Harness permite 8 por defecto)
  maxTareas: 12,
  carpeta: '.escuadra',
  minutosPorTarea: 40,
  intentosVerificacion: 1, // reintentos de una tarea cuando su verificación falla
  reparaciones: 1, // intentos de arreglar la verificación general
  revisar: true,
}

export const ROLES = {
  contratos: 'You define the shared contracts other agents will build against: types, interfaces, API routes and payloads, database schema, component props. Keep them minimal, documented and compilable; stubs are fine. Do not implement features.',
  interfaz: 'You build user interface: screens, components, styles, client-side state and calls to the API exactly as the contracts define them. Respect the existing design system.',
  backend: 'You build server logic: endpoints, services, validation, persistence and error handling, exactly matching the contracts.',
  datos: 'You own the data layer: schema, migrations, seeds, queries and repositories. Migrations must be reversible or clearly additive.',
  pruebas: 'You write automated tests for the behavior described (unit and integration), make them pass against the code that exists and report real bugs you find instead of hiding them.',
  documentacion: 'You write the documentation a teammate needs: README sections, usage, configuration and decisions. Concise and accurate to the code.',
  general: 'You implement the task described, end to end, within your files.',
}

// ---------- utilidades puras ----------

export function slug(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/** Patrón de archivos → expresión regular. "src/ui/" o "src/ui" = todo lo de esa carpeta; admite * ** ? */
export function patronARegex(patron) {
  let p = String(patron).trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!/[*?]/.test(p) && !/\.[a-z0-9]+$/i.test(p.split('/').pop())) p = p.replace(/\/?$/, '/**')
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*' && p[i + 1] === '*') { re += p[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += p[i + 2] === '/' ? 2 : 1 }
    else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}
export const coincide = (archivo, patrones) => patrones.some((p) => patronARegex(p).test(archivo.replace(/\\/g, '/')))

/** Parte fija de un patrón (antes del primer comodín), para detectar solapes entre tareas. */
const prefijo = (p) => { const s = String(p).replace(/\\/g, '/').replace(/^\.\//, ''); const i = s.search(/[*?]/); return (i < 0 ? s : s.slice(0, i)).replace(/\/+$/, '') }
export function seSolapan(a, b) {
  for (const x of a) for (const y of b) {
    const px = prefijo(x), py = prefijo(y)
    if (px === py || px === '' || py === '') return [x, y]
    if (patronARegex(x).test(py) || patronARegex(y).test(px)) return [x, y]
    if ((px + '/').startsWith(py + '/') || (py + '/').startsWith(px + '/')) {
      // "src" contiene "src/ui": solo choca si el patrón más corto abarca la carpeta del otro
      const [corto, largo] = px.length < py.length ? [x, py] : [y, px]
      if (patronARegex(corto).test(largo + '/x') || patronARegex(corto).test(largo)) return [x, y]
    }
  }
  return null
}

/** Valida el plan y lo ordena en oleadas. */
export function validarPlan(plan, { maxTareas = DEFAULTS.maxTareas } = {}) {
  const errores = [], avisos = []
  const tareas = Array.isArray(plan?.tareas) ? plan.tareas : []
  if (!String(plan?.objetivo || '').trim()) errores.push('falta "objetivo": qué se quiere lograr con todo el trabajo')
  if (tareas.length < 2) errores.push('una escuadra necesita al menos 2 tareas; para una sola, hazla tú directamente')
  if (tareas.length > maxTareas) errores.push(`máximo ${maxTareas} tareas por escuadra (hay ${tareas.length}); agrupa las más pequeñas`)
  const ids = new Set()
  for (const t of tareas) {
    t.id = slug(t.id || t.titulo)
    if (!t.id) errores.push('una tarea no tiene id'); else if (ids.has(t.id)) errores.push(`id repetido: ${t.id}`)
    ids.add(t.id)
    if (!t.titulo) errores.push(`${t.id}: falta "titulo"`)
    if (!String(t.instrucciones || '').trim() || String(t.instrucciones).length < 40) errores.push(`${t.id}: las instrucciones son muy cortas; el agente no ve esta conversación, dile qué hacer, con qué contratos y cómo sabe que terminó`)
    if (!Array.isArray(t.archivos) || !t.archivos.length) errores.push(`${t.id}: falta "archivos" (los archivos o carpetas que esta tarea puede cambiar)`)
    t.rol = ROLES[t.rol] ? t.rol : (t.rol ? (avisos.push(`${t.id}: rol "${t.rol}" no existe, uso "general"`), 'general') : 'general')
    t.depende = (t.depende || []).map(slug)
  }
  for (const t of tareas) for (const d of t.depende) if (!ids.has(d)) errores.push(`${t.id} depende de "${d}", que no existe`)
  if (errores.length) return { errores, avisos, oleadas: [] }

  // orden topológico por oleadas
  const nivel = new Map()
  const visitando = new Set()
  const porId = new Map(tareas.map((t) => [t.id, t]))
  const calcular = (id) => {
    if (nivel.has(id)) return nivel.get(id)
    if (visitando.has(id)) throw new Error(`dependencia circular que pasa por "${id}"`)
    visitando.add(id)
    const n = Math.max(-1, ...porId.get(id).depende.map(calcular)) + 1
    visitando.delete(id); nivel.set(id, n); return n
  }
  try { tareas.forEach((t) => calcular(t.id)) } catch (e) { return { errores: [e.message], avisos, oleadas: [] } }
  const oleadas = []
  for (const t of tareas) (oleadas[nivel.get(t.id)] ||= []).push(t.id)

  // ancestros: dos tareas sin relación de dependencia pueden correr a la vez → no deben compartir archivos
  const ancestros = new Map()
  const anc = (id) => { if (ancestros.has(id)) return ancestros.get(id); const s = new Set(); for (const d of porId.get(id).depende) { s.add(d); anc(d).forEach((x) => s.add(x)) } ancestros.set(id, s); return s }
  for (let i = 0; i < tareas.length; i++) for (let j = i + 1; j < tareas.length; j++) {
    const a = tareas[i], b = tareas[j]
    if (anc(a.id).has(b.id) || anc(b.id).has(a.id)) continue
    const choque = seSolapan(a.archivos, b.archivos)
    if (choque) errores.push(`"${a.id}" y "${b.id}" pueden correr a la vez y comparten archivos (${choque[0]} ↔ ${choque[1]}). Dale cada archivo a una sola tarea, o haz que una dependa de la otra.`)
  }
  const deps = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pom.xml', 'build.gradle', 'Cargo.toml', 'requirements.txt']
  const duenos = tareas.filter((t) => deps.some((d) => coincide(d, t.archivos)))
  if (!duenos.length) avisos.push('ninguna tarea es dueña de package.json / pom.xml: si un agente necesita una librería nueva, la anotará en "pendientes" y tendrás que agregarla tú')
  if (oleadas.length === 1 && tareas.length > 2) avisos.push('todas las tareas corren a la vez: si comparten contratos (tipos, API, esquema), conviene una tarea "contratos" primero de la que dependan las demás')
  return { errores, avisos, oleadas }
}

const INFORME = {
  type: 'object',
  properties: {
    hecho: { type: 'boolean', description: 'true only if the task is fully done and verified' },
    resumen: { type: 'string', description: 'What you did, in Spanish, 2-5 sentences' },
    archivos: { type: 'array', items: { type: 'string' }, description: 'Files you created or changed' },
    pendientes: { type: 'array', items: { type: 'string' }, description: 'Anything left undone or that another task/owner must do (e.g. a dependency to add)' },
    riesgos: { type: 'array', items: { type: 'string' } },
  },
  required: ['hecho', 'resumen'],
}
const REVISION = {
  type: 'object',
  properties: {
    aprobado: { type: 'boolean' },
    resumen: { type: 'string', description: 'Verdict in Spanish, 2-4 sentences' },
    problemas: { type: 'array', items: { type: 'object', properties: { gravedad: { type: 'string', enum: ['alta', 'media', 'baja'] }, archivo: { type: 'string' }, detalle: { type: 'string' } }, required: ['gravedad', 'detalle'] } },
  },
  required: ['aprobado', 'resumen'],
}

export function promptTarea(plan, t, { carpetaRel, reintento } = {}) {
  return [
    `You are one member of a team of coding agents working IN PARALLEL on the same project. Role: ${t.rol}. ${ROLES[t.rol]}`,
    '',
    `## Team goal\n${plan.objetivo}`,
    ...(plan.contexto ? ['', `## Project context\n${plan.contexto}`] : []),
    '',
    `## Your task: ${t.titulo} [${t.id}]`,
    t.instrucciones,
    '',
    '## Files you own (the ONLY ones you may create or change)',
    ...t.archivos.map((a) => `- ${a}`),
    ...(t.lee?.length ? ['', '## Read first', ...t.lee.map((a) => `- ${a}`)] : []),
    '',
    '## Rules',
    `- Your working directory is a private copy of the repository (${carpetaRel}). Other agents are changing other files at the same time; you will not see their work, so build against the contracts, not against guesses.`,
    '- Any change outside your files is thrown away automatically. If something outside your files must change (a dependency, a shared type), do NOT change it: write it in "pendientes" with the exact change needed.',
    '- Do not commit, create branches, or run git commands that change history; the team lead commits for you.',
    '- Do not use the escuadra_* tools or start subagents yourself: you are already part of the team.',
    '- Read the existing code and follow its conventions. Finish completely: no TODOs, no placeholder logic.',
    ...(t.verificar ? [`- Before finishing, run \`${t.verificar}\` and make it pass.`] : ['- Before finishing, run the most relevant build or test command available for your files.']),
    ...(reintento ? ['', '## Your previous attempt failed verification. Fix it.', '```', reintento.slice(-6000), '```'] : []),
    '',
    'When done, call the structured output tool with your report (resumen in Spanish).',
  ].join('\n')
}

// ---------- git y procesos ----------

function correr(cmd, args, { cwd, timeoutMs = 120_000, signal, shell = false } = {}) {
  return new Promise((resolve) => {
    const p = execFile(cmd, args, { cwd, timeout: timeoutMs, signal, shell, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      resolve({ codigo: err ? (typeof err.code === 'number' ? err.code : 1) : 0, crudo: stdout || '', salida: `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim(), error: err && typeof err.code !== 'number' ? String(err.message) : null })
    })
    p.stdin?.end()
  })
}
const git = (cwd, ...args) => correr('git', args, { cwd })
const gitOk = async (cwd, ...args) => { const r = await git(cwd, ...args); if (r.codigo !== 0) throw new Error(`git ${args.join(' ')}: ${r.salida.slice(-800)}`); return r.salida }
const comando = (cmd, cwd, signal, timeoutMs = 15 * 60_000) => correr(cmd, [], { cwd, signal, timeoutMs, shell: true })

/** Cambios de la copia de trabajo (incluye archivos nuevos). */
const preparados = new Map() // copia → rutas enlazadas/copiadas por prepararCopia (no son cambios del agente)
async function cambiados(cwd) {
  const r = await git(cwd, 'status', '--porcelain', '-uall', '-z')
  if (r.codigo !== 0) throw new Error(`git status: ${r.salida.slice(-500)}`)
  const s = r.crudo
  const ignorar = preparados.get(path.resolve(cwd)) || new Set()
  const out = []
  const partes = s.split('\0').filter(Boolean)
  for (let i = 0; i < partes.length; i++) {
    const estado = partes[i].slice(0, 2), archivo = partes[i].slice(3)
    if (estado[0] === 'R' || estado[0] === 'C') i++ // el nombre anterior viene después
    if (![...ignorar].some((x) => archivo === x || archivo.startsWith(`${x}/`))) out.push({ estado, archivo })
  }
  return out
}

/** Las dependencias (node_modules, .env…) no están en git: se enlazan/copian a cada copia de trabajo. */
async function prepararCopia(raiz, copia) {
  const hechos = new Set()
  preparados.set(path.resolve(copia), hechos)
  const enlazar = async (de, a, rel) => { try { await symlink(de, a, 'junction'); hechos.add(rel) } catch {} }
  for (const n of await readdir(raiz).catch(() => [])) {
    if (n === 'node_modules' || n === '.venv' || n === 'venv') {
      if (!existsSync(path.join(copia, n))) await enlazar(path.join(raiz, n), path.join(copia, n), n)
    } else if (/^\.env(\..+)?$/.test(n) && !existsSync(path.join(copia, n))) { try { await cp(path.join(raiz, n), path.join(copia, n)); hechos.add(n) } catch {} }
  }
  // node_modules de subproyectos (monorepo, frontend/ y backend/)
  for (const n of await readdir(raiz, { withFileTypes: true }).catch(() => [])) {
    if (!n.isDirectory() || n.name.startsWith('.') || n.name === 'node_modules') continue
    const nm = path.join(raiz, n.name, 'node_modules')
    if (existsSync(nm) && existsSync(path.join(copia, n.name)) && !existsSync(path.join(copia, n.name, 'node_modules'))) await enlazar(nm, path.join(copia, n.name, 'node_modules'), `${n.name}/node_modules`)
  }
}

/** Prepara para commit solo lo que cambió el agente (nunca los enlaces a node_modules ni los .env copiados). */
async function agregar(cwd) {
  const lista = (await cambiados(cwd)).map((c) => c.archivo)
  for (let i = 0; i < lista.length; i += 200) await gitOk(cwd, 'add', '-A', '--', ...lista.slice(i, i + 200))
  return lista
}

async function limitar(n, items, fn) {
  const res = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k], k) } }))
  return res
}

const textoDe = (output) => (output || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()

// ---------- plugin ----------

export function apply(ctx, cfg = {}) {
  const opt = { ...DEFAULTS, ...cfg }
  const salida = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }
  const ESQUELETO = { git, gitOk, comando, cambiados, prepararCopia } // para pruebas

  ctx.systemPrompt.section({
    name: 'escuadra',
    order: 2460,
    interpolate: false,
    text: [
      '## Escuadra: several coding agents in parallel',
      'When a coding request spans several independent areas (e.g. UI + API + database + tests) or would take you a long time alone, split it and run it with the escuadra tools instead of doing everything sequentially:',
      '1. Read enough of the repository to know where things live. 2. Call escuadra_repartir with the goal and 2-8 tasks. Each task: id, rol (contratos | interfaz | backend | datos | pruebas | documentacion | general), titulo, instrucciones (self-contained: the agent does NOT see this conversation — include the contracts, names, paths and how it knows it is done), archivos (globs it owns; parallel tasks must not share files), depende (ids), verificar (optional command, e.g. "npm test -- src/api"). 3. Show the user the plan in 3-6 lines. 4. Call escuadra_ejecutar. 5. Report what each agent did, the review verdict and anything pending.',
      'Good splits: first a "contratos" task that writes shared types/interfaces/schema that the others depend on; then interfaz, backend, datos in parallel; then pruebas. Give package.json/pom.xml/Cargo.toml to exactly one task. Do not use the escuadra for small changes, for one-file work, or when the repository is not a git repo.',
    ].join('\n'),
  })

  const desdeCopia = (cwd) => path.resolve(cwd).split(path.sep).includes(opt.carpeta)
  const raizDe = async (cwd) => {
    if (desdeCopia(cwd)) throw new Error('Esta herramienta no se usa desde dentro de una tarea de la escuadra.')
    const r = await git(cwd, 'rev-parse', '--show-toplevel')
    if (r.codigo !== 0) throw new Error('Esto no es un repositorio git. La escuadra necesita git para dar a cada agente su copia (git init y un primer commit).')
    return path.resolve(r.salida.split('\n')[0])
  }
  const excluir = async (raiz) => {
    const f = path.join(raiz, '.git', 'info', 'exclude')
    const t = await readFile(f, 'utf8').catch(() => '')
    if (!t.split(/\r?\n/).includes(`${opt.carpeta}/`)) { await mkdir(path.dirname(f), { recursive: true }); await appendFile(f, `${t && !t.endsWith('\n') ? '\n' : ''}${opt.carpeta}/\n`) }
  }

  ctx.tools.register({
    name: 'escuadra_repartir',
    description: 'Valida y guarda el reparto de un trabajo de código entre varios agentes que trabajarán en paralelo (cada uno en su copia del repo). Detecta tareas simultáneas que comparten archivos, dependencias inexistentes o circulares, y devuelve las oleadas. Luego llama escuadra_ejecutar.',
    timeoutMs: 60_000,
    parameters: {
      type: 'object',
      required: ['objetivo', 'tareas'],
      properties: {
        objetivo: { type: 'string', description: 'Qué se quiere lograr con todo el trabajo, con los criterios de terminado.' },
        contexto: { type: 'string', description: 'Lo que todos los agentes deben saber del proyecto: stack, convenciones, contratos ya existentes, comandos.' },
        verificacion: { type: 'string', description: 'Comando que debe pasar al integrar todo, ej. "npm run build && npm test" o "mvn -q test".' },
        tareas: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'titulo', 'instrucciones', 'archivos'],
            properties: {
              id: { type: 'string' }, rol: { type: 'string', enum: Object.keys(ROLES) }, titulo: { type: 'string' },
              instrucciones: { type: 'string', description: 'Completas y autosuficientes: el agente no ve esta conversación.' },
              archivos: { type: 'array', items: { type: 'string' }, description: 'Archivos o carpetas que puede cambiar (globs: src/api/**, src/tipos.ts).' },
              lee: { type: 'array', items: { type: 'string' }, description: 'Archivos que debe leer primero.' },
              depende: { type: 'array', items: { type: 'string' } },
              verificar: { type: 'string', description: 'Comando para comprobar esta tarea.' },
            },
          },
        },
      },
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      let raiz
      try { raiz = await raizDe(cwd) } catch (e) { return `❌ ${e.message}` }
      const plan = { objetivo: args.objetivo, contexto: args.contexto, verificacion: args.verificacion, tareas: (args.tareas || []).map((t) => ({ ...t })) }
      const { errores, avisos, oleadas } = validarPlan(plan, opt)
      if (errores.length) return ['❌ El reparto no sirve todavía:', ...errores.map((e) => `- ${e}`), ...(avisos.length ? ['', 'Avisos:', ...avisos.map((a) => `- ${a}`)] : []), '', 'Corrígelo y vuelve a llamar escuadra_repartir.'].join('\n')
      plan.oleadas = oleadas
      await mkdir(path.join(raiz, opt.carpeta), { recursive: true })
      await excluir(raiz)
      await writeFile(path.join(raiz, opt.carpeta, 'plan.json'), JSON.stringify(plan, null, 2))
      const porId = new Map(plan.tareas.map((t) => [t.id, t]))
      return [
        `✅ Reparto listo: ${plan.tareas.length} tareas en ${oleadas.length} oleada${oleadas.length > 1 ? 's' : ''} (hasta ${opt.maxParalelo} agentes a la vez).`,
        ...oleadas.map((o, i) => `Oleada ${i + 1}: ${o.map((id) => `${id} (${porId.get(id).rol})`).join(' · ')}`),
        ...(avisos.length ? ['', 'Avisos:', ...avisos.map((a) => `- ${a}`)] : []),
        '',
        'Muéstrale el plan al usuario en pocas líneas y llama escuadra_ejecutar.',
      ].join('\n')
    },
  })

  async function lanzar(exec, { label, cwd, prompt, esquema }) {
    const act = await ctx.subagents.startActivation({
      provider: opt.provider || 'spawn',
      label,
      delivery: 'caller',
      signal: exec.signal,
      request: { parent: exec.agent, cwd, prompt: [{ type: 'text', text: prompt }], ...(esquema ? { outputSchema: esquema } : {}), ...(opt.agentOptions ? { agentOptions: opt.agentOptions } : {}) },
    })
    try {
      const r = await act.result
      return { ...r, texto: textoDe(r.output), informe: r.structured ?? null }
    } finally { await act.dispose?.().catch(() => {}) }
  }

  async function ejecutarPlan(exec, plan, raiz, registrar, { aplicar = opt.aplicar } = {}) {
    const inicio = Date.now()
    const corrida = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')
    const dirCorrida = path.join(raiz, opt.carpeta, corrida)
    const rel = (p) => path.relative(raiz, p).split(path.sep).join('/')
    const base = (await gitOk(raiz, 'rev-parse', 'HEAD')).trim()
    const ramaActual = (await gitOk(raiz, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()
    const identidad = ['-c', 'user.name=dsh-escuadra', '-c', 'user.email=escuadra@localhost']
    const tieneIdentidad = (await git(raiz, 'config', 'user.name')).codigo === 0
    const commit = (cwd, msg) => (tieneIdentidad ? gitOk(cwd, 'commit', '-q', '--no-verify', '-m', msg) : gitOk(cwd, ...identidad, 'commit', '-q', '--no-verify', '-m', msg))
    const ramaInt = `escuadra/${corrida}/integracion`
    const dirInt = path.join(dirCorrida, '_integracion')
    await mkdir(dirCorrida, { recursive: true })
    await gitOk(raiz, 'worktree', 'add', '-q', '-b', ramaInt, dirInt, base)
    await prepararCopia(raiz, dirInt)
    const estado = { corrida, base, ramaInt, tareas: {}, oleadas: [], integracion: [], verificacion: null, revision: null }
    const porId = new Map(plan.tareas.map((t) => [t.id, t]))
    const fallidas = new Set()

    const trabajar = async (id) => {
      const t = porId.get(id)
      const e = (estado.tareas[id] = { id, titulo: t.titulo, rol: t.rol, inicio: Date.now() })
      const bloqueo = t.depende.find((d) => fallidas.has(d))
      if (bloqueo) { e.estado = 'omitida'; e.motivo = `depende de "${bloqueo}", que no se completó`; fallidas.add(id); return }
      const rama = `escuadra/${corrida}/${id}`
      const dir = path.join(dirCorrida, id)
      const desde = (await gitOk(dirInt, 'rev-parse', 'HEAD')).trim()
      await gitOk(raiz, 'worktree', 'add', '-q', '-b', rama, dir, desde)
      await prepararCopia(raiz, dir)
      e.rama = rama
      let reintento = null
      for (let intento = 0; intento <= opt.intentosVerificacion; intento++) {
        registrar(`${id}: agente trabajando${intento ? ` (intento ${intento + 1})` : ''}`)
        let r
        try { r = await lanzar(exec, { label: `${t.rol} · ${t.titulo}`, cwd: dir, prompt: promptTarea(plan, t, { carpetaRel: rel(dir), reintento }), esquema: INFORME }) }
        catch (err) { e.estado = 'error'; e.motivo = String(err?.message || err).slice(0, 600); fallidas.add(id); return }
        e.informe = r.informe || { hecho: r.stopReason === 'completed', resumen: r.texto.slice(0, 1200) }
        e.paro = r.stopReason
        // lo que cambió fuera de sus archivos se descarta
        const fuera = []
        for (const c of await cambiados(dir)) {
          if (coincide(c.archivo, t.archivos)) continue
          fuera.push(c.archivo)
          if (c.estado.includes('?') || c.estado.includes('A')) await rm(path.join(dir, c.archivo), { force: true, recursive: true })
          else await git(dir, 'checkout', 'HEAD', '--', c.archivo)
        }
        if (fuera.length) e.descartados = [...new Set([...(e.descartados || []), ...fuera])]
        if (!t.verificar) break
        const v = await comando(t.verificar, dir, exec.signal)
        e.verificacion = { ok: v.codigo === 0, salida: v.salida.slice(-2500) }
        if (v.codigo === 0) break
        reintento = `$ ${t.verificar}\n${v.salida}`
      }
      const lista = await cambiados(dir)
      if (lista.length) { await agregar(dir); await commit(dir, `escuadra(${t.rol}): ${t.titulo}`) }
      e.archivos = lista.map((c) => c.archivo)
      const ok = r_ok(e)
      e.estado = ok ? 'hecha' : 'incompleta'
      if (!ok) fallidas.add(id)
      e.ms = Date.now() - e.inicio
      await git(raiz, 'worktree', 'remove', '--force', dir)
    }
    const r_ok = (e) => e.paro === 'completed' && e.informe?.hecho !== false && (!e.verificacion || e.verificacion.ok) && e.archivos.length > 0

    for (const [n, oleada] of plan.oleadas.entries()) {
      registrar(`oleada ${n + 1}: ${oleada.join(', ')}`)
      await limitar(opt.maxParalelo, oleada, trabajar)
      // integrar lo que salió bien (lo incompleto también, si dejó cambios: queda marcado)
      for (const id of oleada) {
        const e = estado.tareas[id]
        if (!e.rama || !e.archivos?.length) continue
        const m = await git(dirInt, ...(tieneIdentidad ? [] : identidad), 'merge', '--no-ff', '-q', '-m', `escuadra: integra ${id}`, e.rama)
        if (m.codigo === 0) { estado.integracion.push({ id, ok: true }); continue }
        const conflictos = (await git(dirInt, 'diff', '--name-only', '--diff-filter=U')).salida.split('\n').filter(Boolean)
        registrar(`conflicto al integrar ${id}: ${conflictos.join(', ')}`)
        let resuelto = false
        if (conflictos.length) {
          try {
            await lanzar(exec, {
              label: `integrador · ${id}`, cwd: dirInt,
              prompt: [`You are the integrator of a team of coding agents. Merging the work of task "${id}" (${porId.get(id).titulo}) produced git conflicts in:`, ...conflictos.map((c) => `- ${c}`), '', `Team goal: ${plan.objetivo}`, '', 'Resolve every conflict keeping the intent of BOTH sides (never just pick one side unless the other is obsolete). Remove all conflict markers, make the code compile, and do not run git commit. Reply with a one-paragraph summary in Spanish.'].join('\n'),
            })
            const quedan = (await correr('git', ['grep', '-l', '-E', '^(<<<<<<<|>>>>>>>) ', '--', ...conflictos], { cwd: dirInt })).salida.split('\n').filter(Boolean)
            if (!quedan.length) { await agregar(dirInt); await gitOk(dirInt, ...(tieneIdentidad ? [] : identidad), 'commit', '-q', '--no-verify', '--no-edit'); resuelto = true }
          } catch { /* se aborta abajo */ }
        }
        if (!resuelto) { await git(dirInt, 'merge', '--abort'); fallidas.add(id); e.estado = 'no integrada'; if (!conflictos.length) e.motivo = `git merge falló: ${m.salida.slice(-400)}` }
        estado.integracion.push({ id, ok: resuelto, conflictos })
      }
      estado.oleadas.push(oleada)
    }

    // verificación general con intentos de reparación
    if (plan.verificacion) {
      for (let i = 0; i <= opt.reparaciones; i++) {
        registrar(`verificación general${i ? ` (tras reparación ${i})` : ''}`)
        const v = await comando(plan.verificacion, dirInt, exec.signal)
        estado.verificacion = { ok: v.codigo === 0, salida: v.salida.slice(-3000), intentos: i + 1 }
        if (v.codigo === 0 || i === opt.reparaciones) break
        try {
          await lanzar(exec, { label: 'reparador', cwd: dirInt, prompt: [`The team integrated its work but \`${plan.verificacion}\` fails. Fix the cause with the smallest correct change (do not weaken or delete tests). Do not commit.`, `Team goal: ${plan.objetivo}`, '```', v.salida.slice(-7000), '```', 'Reply with what you fixed, in Spanish.'].join('\n') })
          if ((await cambiados(dirInt)).length) { await agregar(dirInt); await commit(dirInt, 'escuadra: reparación de la verificación general') }
        } catch { break }
      }
    }

    // revisión independiente
    const diffStat = (await git(dirInt, 'diff', '--stat', `${base}..HEAD`)).salida
    if (opt.revisar && diffStat.trim()) {
      registrar('revisión independiente')
      try {
        const r = await lanzar(exec, {
          label: 'revisor', cwd: dirInt, esquema: REVISION,
          prompt: [
            'You are a senior reviewer who did NOT write this code. A team of agents built the following in parallel. Review it against the goal: correctness, the pieces actually fitting together (calls match contracts, names match), missing parts, security, and anything left as placeholder.',
            `## Goal\n${plan.objetivo}`,
            '## Tasks', ...plan.tareas.map((t) => `- ${t.id} (${t.rol}): ${t.titulo} — ${estado.tareas[t.id]?.estado || 'sin correr'}`),
            '## Changes', '```', diffStat.slice(-4000), '```',
            `Read the full diff with \`git diff ${base.slice(0, 12)}..HEAD\` and open files as needed. Do not modify anything. Report with the structured output tool (Spanish). aprobado = true only if it is ready to ship.`,
          ].join('\n'),
        })
        estado.revision = r.informe || { aprobado: false, resumen: r.texto.slice(0, 1500) }
      } catch (err) { estado.revision = { aprobado: false, resumen: `No se pudo revisar: ${err.message}` } }
    }

    // aplicar a la rama actual si nadie la movió y está limpia
    const cabeza = (await gitOk(raiz, 'rev-parse', 'HEAD')).trim()
    const sucia = (await cambiados(raiz)).filter((c) => !c.archivo.startsWith(`${opt.carpeta}/`)).length > 0
    const hayCambios = (await gitOk(dirInt, 'rev-parse', 'HEAD')).trim() !== base
    if (!hayCambios) estado.aplicado = 'sin cambios'
    else if (aplicar === false) estado.aplicado = `no (desactivado): los cambios están en la rama ${ramaInt}`
    else if (cabeza !== base || sucia) estado.aplicado = `no: ${cabeza !== base ? 'la rama actual avanzó' : 'hay cambios sin guardar'} mientras trabajaba la escuadra. Los cambios están en la rama ${ramaInt} (git merge ${ramaInt}).`
    else { await gitOk(raiz, 'merge', '--ff-only', '-q', ramaInt); estado.aplicado = `sí, en ${ramaActual}` }
    await git(raiz, 'worktree', 'remove', '--force', dirInt)
    await git(raiz, 'worktree', 'prune')
    estado.ms = Date.now() - inicio
    await writeFile(path.join(dirCorrida, 'informe.json'), JSON.stringify(estado, null, 2))
    return estado
  }

  function informeTexto(plan, estado) {
    const min = (ms) => `${Math.max(1, Math.round(ms / 60000))} min`
    const icono = { hecha: '✅', incompleta: '⚠️', error: '❌', omitida: '⏭️', 'no integrada': '❌' }
    const lineas = [`Escuadra ${estado.corrida}: ${plan.tareas.length} tareas en ${min(estado.ms)} (base ${estado.base.slice(0, 8)}).`, '']
    for (const t of plan.tareas) {
      const e = estado.tareas[t.id] || {}
      lineas.push(`${icono[e.estado] || '•'} ${t.id} (${t.rol}) — ${e.estado || 'sin correr'}${e.ms ? `, ${min(e.ms)}` : ''}`)
      if (e.informe?.resumen) lineas.push(`   ${e.informe.resumen.replace(/\s+/g, ' ').slice(0, 500)}`)
      if (e.motivo) lineas.push(`   motivo: ${e.motivo}`)
      if (e.archivos?.length) lineas.push(`   archivos: ${e.archivos.slice(0, 12).join(', ')}${e.archivos.length > 12 ? ` y ${e.archivos.length - 12} más` : ''}`)
      if (e.descartados?.length) lineas.push(`   ⚠ cambios fuera de sus archivos descartados: ${e.descartados.join(', ')}`)
      if (e.verificacion && !e.verificacion.ok) lineas.push(`   verificación falló: ${e.verificacion.salida.split('\n').slice(-6).join(' | ').slice(0, 500)}`)
      for (const p of e.informe?.pendientes || []) lineas.push(`   pendiente: ${p}`)
    }
    const conflictos = estado.integracion.filter((i) => i.conflictos?.length)
    if (conflictos.length) lineas.push('', ...conflictos.map((c) => `Integración ${c.id}: conflicto en ${c.conflictos.join(', ')} → ${c.ok ? 'resuelto por el integrador' : 'NO resuelto, no se integró'}`))
    if (estado.verificacion) lineas.push('', `Verificación general: ${estado.verificacion.ok ? '✅ pasa' : '❌ falla'}${estado.verificacion.intentos > 1 ? ` (tras ${estado.verificacion.intentos - 1} reparación)` : ''}`, ...(estado.verificacion.ok ? [] : [estado.verificacion.salida.split('\n').slice(-12).join('\n')]))
    if (estado.revision) {
      lineas.push('', `Revisión independiente: ${estado.revision.aprobado ? '✅ aprobada' : '⚠️ con observaciones'} — ${estado.revision.resumen}`)
      for (const p of estado.revision.problemas || []) lineas.push(`- [${p.gravedad}] ${p.archivo ? `${p.archivo}: ` : ''}${p.detalle}`)
    }
    lineas.push('', `Aplicado a la rama actual: ${estado.aplicado}`, `Detalle: ${opt.carpeta}/${estado.corrida}/informe.json`)
    if (estado.revision && !estado.revision.aprobado) lineas.push('Corrige tú los problemas de la revisión (o lanza otra escuadra para ellos) antes de decir que está terminado.')
    return lineas.join('\n')
  }

  ctx.tools.register({
    name: 'escuadra_ejecutar',
    description: 'Ejecuta el último reparto de escuadra_repartir: lanza los agentes en paralelo (cada uno en su copia del repo), integra por oleadas resolviendo conflictos, corre la verificación general, pide una revisión independiente y aplica el resultado a la rama actual. Puede tardar varios minutos.',
    timeoutMs: 4 * 60 * 60_000,
    parameters: { type: 'object', properties: { aplicar: { type: 'boolean', description: 'false para dejar el resultado solo en su rama sin aplicarlo.' } } },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      let raiz
      try { raiz = await raizDe(cwd) } catch (e) { return `❌ ${e.message}` }
      let plan
      try { plan = JSON.parse(await readFile(path.join(raiz, opt.carpeta, 'plan.json'), 'utf8')) } catch { return '❌ No hay reparto. Llama primero escuadra_repartir.' }
      const sucios = (await cambiados(raiz)).filter((c) => !c.archivo.startsWith(`${opt.carpeta}/`))
      if (sucios.length) return `❌ Hay cambios sin guardar (${sucios.slice(0, 6).map((c) => c.archivo).join(', ')}${sucios.length > 6 ? '…' : ''}). Los agentes parten del último commit, así que haz commit primero (o descártalos) y vuelve a llamar escuadra_ejecutar.`
      if ((await git(raiz, 'rev-parse', 'HEAD')).codigo !== 0) return '❌ El repositorio no tiene commits. Haz un primer commit.'
      const bitacora = []
      const registrar = (m) => { bitacora.push(`${new Date().toTimeString().slice(0, 8)} ${m}`); ctx.logger?.info?.(`[escuadra] ${m}`) }
      try {
        const estado = await ejecutarPlan(exec, plan, raiz, registrar, { aplicar: args?.aplicar ?? opt.aplicar })
        return informeTexto(plan, estado)
      } catch (e) {
        if (exec.signal?.aborted) return '⏹️ Escuadra detenida. Las copias de trabajo quedaron en .escuadra/ (escuadra_limpiar las borra).'
        return `❌ La escuadra se detuvo: ${e.message}\n\nBitácora:\n${bitacora.slice(-15).join('\n')}`
      }
    },
  })

  ctx.tools.register({
    name: 'escuadra_limpiar',
    description: 'Borra las copias de trabajo y las ramas escuadra/* de corridas anteriores (no toca la rama actual).',
    timeoutMs: 120_000,
    parameters: { type: 'object', properties: { ramas: { type: 'boolean', description: 'true para borrar también las ramas escuadra/* (por defecto true).' } } },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      let raiz
      try { raiz = await raizDe(cwd) } catch (e) { return `❌ ${e.message}` }
      const lista = (await git(raiz, 'worktree', 'list', '--porcelain')).salida.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).filter((d) => path.resolve(d).includes(`${path.sep}${opt.carpeta}${path.sep}`))
      for (const d of lista) await git(raiz, 'worktree', 'remove', '--force', d)
      await git(raiz, 'worktree', 'prune')
      let ramas = []
      if (args?.ramas !== false) {
        ramas = (await git(raiz, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/escuadra/')).salida.split('\n').filter(Boolean)
        for (const r of ramas) await git(raiz, 'branch', '-D', r)
      }
      for (const n of await readdir(path.join(raiz, opt.carpeta)).catch(() => [])) if (/^\d{8}-\d{6}$/.test(n)) await rm(path.join(raiz, opt.carpeta, n, '_integracion'), { recursive: true, force: true }).catch(() => {})
      return `🧹 ${lista.length} copias de trabajo y ${ramas.length} ramas borradas. Los informes siguen en ${opt.carpeta}/.`
    },
  })

  return ESQUELETO
}
