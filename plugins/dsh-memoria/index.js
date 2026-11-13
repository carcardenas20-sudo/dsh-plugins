// dsh-memoria — memoria de proyecto para DeepSeek Harness.
//
// Tres capas, todas dentro del proyecto (texto plano, se puede leer y editar):
//   1. Bitácora detallada: .dsh-memoria/bitacora/AAAA-MM.md. Cada turno queda anotado
//      solo: lo que pediste, lo que respondió el agente, archivos que tocó y comandos.
//   2. Memoria viva: un bloque dentro de AGENTS.md (que dsh lee solo al abrir cada
//      conversación) con qué es el proyecto, stack, decisiones, reglas, estado y
//      pendientes. Al terminar cada turno con trabajo real, Flash lo actualiza.
//   3. Herramientas: memoria_buscar (encuentra cualquier detalle en la bitácora),
//      memoria_anotar (guarda al instante una decisión, regla o pendiente) y
//      memoria_ver (muestra la memoria viva) y memoria_importar (recupera las
//      conversaciones anteriores de dsh y los documentos del proyecto).

import { mkdir, readFile, writeFile, rename, appendFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

export const name = 'memoria'
export const inject = ['tools', 'llm', 'workingDirectory']

const DEFAULTS = {
  carpeta: '.dsh-memoria',
  archivoMemoria: 'AGENTS.md',
  modelo: { model: 'deepseek-flash' }, // provider: por defecto el del agente
  consolidar: true, // actualizar la memoria viva con Flash al cerrar turnos con trabajo
  maxMemoria: 24000, // tamaño objetivo del bloque de memoria viva (si lo pasa, Flash lo condensa)
  limiteDuro: 48000, // nunca más que esto (dsh carga hasta ~64 KB de AGENTS.md)
  maxPedido: 4000,
  maxRespuesta: 3000,
  timeoutSegundos: 90,
  dshHome: undefined, // carpeta de datos de dsh; por defecto DSH_HOME o ~/.dsh
  maxDocumentos: 60000, // caracteres de documentos del proyecto que se leen al importar
  loteImportar: 80000, // caracteres de historial por llamada a Flash al importar (Flash tiene 1M de contexto)
  maxLotes: 60,
}

export const INICIO = '<!-- dsh-memoria:inicio — bloque mantenido por el plugin dsh-memoria; puedes editarlo -->'
export const FIN = '<!-- dsh-memoria:fin -->'

export const SECCIONES = {
  proyecto: 'Qué es el proyecto',
  stack: 'Stack y estructura',
  decision: 'Decisiones',
  regla: 'Reglas y preferencias',
  estado: 'Estado actual',
  pendiente: 'Pendientes',
  hecho: 'Datos importantes',
}

const ENCABEZADO = [
  '## Memoria del proyecto',
  '',
  '> Instrucciones para el agente: esta es la memoria acumulada de todas las conversaciones de este proyecto. Úsala como verdad sobre decisiones y reglas.',
  '> Si necesitas un detalle de algo pasado (qué se hizo, por qué, qué archivo, qué error), usa `memoria_buscar` antes de suponer.',
  '> Cuando el usuario diga "recuerda…", se tome una decisión, se defina una regla o quede algo pendiente, guárdalo con `memoria_anotar`.',
].join('\n')

// ---------- utilidades ----------

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const corta = (s, n) => { const t = String(s ?? '').trim(); return t.length <= n ? t : `${t.slice(0, n)}… [+${t.length - n} caracteres]` }
const hoy = (d = new Date()) => {
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Nunca guardar claves: se reemplazan antes de escribir cualquier cosa.
export function sinSecretos(t) {
  return String(t ?? '')
    .replace(/\b(sk|pk|rk)[-_](live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/g, '[clave oculta]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[token oculto]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[clave oculta]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[jwt oculto]')
    .replace(/((?:password|passwd|contrase(?:ñ|n)a|secret|api[_-]?key|token)\s*[:=]\s*)(["']?)[^\s"']{4,}\2/gi, '$1[oculto]')
    .replace(/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/([^:\s/]+):[^@\s]+@/gi, '$1://$2:[oculto]@')
}

const textoDe = (m) => (m?.content ?? []).map((b) => b?.type === 'text' ? b.text : b?.type === 'image' ? '[imagen]' : '').join('\n').trim()

function resumenHerramienta(nombre, args, res) {
  const a = args && typeof args === 'object' ? args : {}
  const ruta = a.path ?? a.file_path ?? a.filePath ?? a.file ?? a.target
  const partes = [nombre]
  if (a.command ?? a.cmd) partes.push(`\`${corta(a.command ?? a.cmd, 200)}\``)
  else if (ruta) partes.push(`\`${corta(ruta, 160)}\``)
  else if (a.pattern ?? a.query) partes.push(`"${corta(a.pattern ?? a.query, 80)}"`)
  if (res?.isError) {
    const err = (res.content ?? []).map((b) => b?.text ?? '').join(' ').trim()
    partes.push(`→ ERROR: ${corta(err, 240)}`)
  }
  return partes.join(' ')
}

export const ESCRIBE = /^(write|edit|multi_?edit|apply_?patch|create|delete|move|rename|patch|str_replace|notebook_edit)/i
export const EJECUTA = /^(bash|shell|exec|run|terminal)/i

// ---------- bloque de memoria en AGENTS.md ----------

export function extraerBloque(texto) {
  const i = texto.indexOf(INICIO)
  const j = texto.indexOf(FIN)
  if (i < 0 || j < i) return null
  return texto.slice(i + INICIO.length, j).trim()
}

export function ponerBloque(texto, bloque) {
  const contenido = `${INICIO}\n${bloque.trim()}\n${FIN}`
  const i = texto.indexOf(INICIO)
  const j = texto.indexOf(FIN)
  if (i >= 0 && j > i) return texto.slice(0, i) + contenido + texto.slice(j + FIN.length)
  const base = texto.trimEnd()
  return (base ? `${base}\n\n` : '') + contenido + '\n'
}

export function bloqueVacio() {
  return [ENCABEZADO, '', ...Object.values(SECCIONES).map((s) => `### ${s}\n- (sin datos todavía)`)].join('\n')
}

/** Agrega una línea a una sección del bloque (sin LLM). */
export function anotarEnBloque(bloque, tipo, texto, fecha) {
  const titulo = SECCIONES[tipo] ?? SECCIONES.hecho
  const linea = tipo === 'proyecto' || tipo === 'stack' ? `- ${texto}` : `- ${texto} _(${fecha})_`
  let b = bloque || bloqueVacio()
  if (!b.includes('## Memoria del proyecto')) b = `${ENCABEZADO}\n\n${b}`
  const h = `### ${titulo}`
  if (!b.includes(h)) return `${b.trimEnd()}\n\n${h}\n${linea}`
  const ini = b.indexOf(h) + h.length
  const sig = b.indexOf('\n### ', ini)
  const fin = sig < 0 ? b.length : sig
  let cuerpo = b.slice(ini, fin).replace(/\n- \(sin datos todavía\)/, '')
  cuerpo = `${cuerpo.trimEnd()}\n${linea}\n`
  return b.slice(0, ini) + cuerpo + (sig < 0 ? '' : b.slice(sig))
}

/** Marca un pendiente como resuelto (lo quita de Pendientes y lo deja en Estado). */
export function resolverEnBloque(bloque, texto, fecha) {
  const h = `### ${SECCIONES.pendiente}`
  const ini = bloque.indexOf(h)
  if (ini >= 0) {
    const sig = bloque.indexOf('\n### ', ini + h.length)
    const fin = sig < 0 ? bloque.length : sig
    const palabras = norm(texto).split(/\W+/).filter((w) => w.length > 3)
    const lineas = bloque.slice(ini + h.length, fin).split('\n')
    const restantes = lineas.filter((l) => {
      if (!l.startsWith('- ')) return true
      const n = norm(l)
      const coinciden = palabras.filter((w) => n.includes(w)).length
      return !(palabras.length && coinciden / palabras.length >= 0.6)
    })
    bloque = bloque.slice(0, ini + h.length) + restantes.join('\n') + bloque.slice(fin)
  }
  return anotarEnBloque(bloque, 'estado', `Resuelto: ${texto}`, fecha)
}

/**
 * Si el bloque pasa del límite duro, quita las viñetas MÁS ANTIGUAS de las secciones
 * menos críticas (primero "Datos importantes", luego "Estado actual", luego "Stack"),
 * nunca de Decisiones, Reglas ni Pendientes, y nunca corta el final del bloque.
 */
export function recortarSeguro(bloque, limite) {
  if (bloque.length <= limite) return bloque
  const orden = [SECCIONES.hecho, SECCIONES.estado, SECCIONES.stack, SECCIONES.proyecto]
  let b = bloque
  let quitadas = 0
  for (const titulo of orden) {
    while (b.length > limite) {
      const h = `### ${titulo}`
      const ini = b.indexOf(h)
      if (ini < 0) break
      const sig = b.indexOf('\n### ', ini + h.length)
      const fin = sig < 0 ? b.length : sig
      const lineas = b.slice(ini + h.length, fin).split('\n')
      const k = lineas.findIndex((l) => l.startsWith('- ') && !l.includes('(sin datos'))
      if (k < 0 || lineas.filter((l) => l.startsWith('- ')).length <= 1) break
      lineas.splice(k, 1)
      quitadas++
      b = b.slice(0, ini + h.length) + lineas.join('\n') + b.slice(fin)
    }
  }
  if (quitadas) b = anotarEnBloque(b, 'hecho', `(se quitaron ${quitadas} datos antiguos por tamaño; siguen en la bitácora, búscalos con memoria_buscar)`, new Date().toISOString().slice(0, 10))
  return b
}

// ---------- búsqueda en la bitácora ----------

export function partirEntradas(md) {
  return md.split(/\n(?=## )/).map((e) => e.trim()).filter((e) => e.startsWith('## '))
}

export function buscarEntradas(entradas, consulta, max = 6) {
  const palabras = [...new Set(norm(consulta).split(/[^a-z0-9._/-]+/).filter((w) => w.length > 1))]
  if (!palabras.length) return entradas.slice(-max).reverse().map((e) => ({ e, p: 0 }))
  return entradas
    .map((e, i) => {
      const n = norm(e)
      let p = 0
      for (const w of palabras) {
        const c = n.split(w).length - 1
        if (c) p += 3 + Math.min(c, 5)
      }
      const todas = palabras.every((w) => n.includes(w))
      return { e, p: p + (todas ? 10 : 0) + i / 1e6 } // a igual puntaje, la más reciente
    })
    .filter((x) => x.p >= 3)
    .sort((a, b) => b.p - a.p)
    .slice(0, max)
}

// ---------- consolidación con el LLM ----------

export const INSTRUCCION_CONSOLIDAR = [
  'Mantienes la MEMORIA de un proyecto de software. Recibes la memoria actual y el registro del último turno de trabajo entre el usuario y un agente programador.',
  'Devuelve SOLO la memoria actualizada en Markdown, con exactamente estas secciones y en este orden:',
  ...Object.values(SECCIONES).map((s) => `### ${s}`),
  'Reglas:',
  '- Conserva TODO lo que siga siendo cierto. Nunca borres decisiones ni reglas salvo que el usuario las haya cambiado explícitamente; si cambian, reemplázalas y anota "(antes: …)".',
  '- Agrega solo información duradera: decisiones con su porqué, reglas y preferencias del usuario, nombres de archivos clave, comandos para correr o probar, integraciones, errores importantes y cómo se resolvieron, estado de avance y pendientes.',
  '- No anotes charla, saludos ni pasos triviales. No inventes nada que no esté en el registro o en la memoria.',
  '- "Estado actual": qué funciona y en qué se va, en pocas líneas, reemplazando lo viejo.',
  '- "Pendientes": quita lo que el turno resolvió y agrega lo que quedó abierto.',
  '- Mantén fechas entre paréntesis en decisiones y reglas, formato (AAAA-MM-DD).',
  '- Viñetas cortas y concretas, en español. Nunca incluyas contraseñas, claves ni tokens.',
  '- Si el turno no aporta nada duradero, devuelve la memoria actual sin cambios.',
].join('\n')

export function limpiarRespuestaLLM(t) {
  let s = String(t ?? '').trim()
  s = s.replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```\s*$/, '')
  const i = s.indexOf(`### ${SECCIONES.proyecto}`)
  if (i < 0) return null // no respetó el formato: no tocar la memoria
  return s.slice(i).trim()
}

// ---------- importar conversaciones anteriores de dsh ----------

/** Lee un log de sesión de dsh (.jsonl o .jsonl.zstd con varios frames) y devuelve sus eventos. */
export function leerEventosSesion(buf, nombre = '') {
  let texto
  if (nombre.endsWith('.zstd') || (buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd)) {
    if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('esta versión de Node no trae zstd; actualiza Node a 24 o más nuevo')
    const magia = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
    const pos = []
    for (let i = buf.indexOf(magia); i >= 0; i = buf.indexOf(magia, i + 4)) pos.push(i)
    const partes = []
    // Un frame puede contener por casualidad los bytes mágicos: si falla, se une con el siguiente.
    let desde = 0
    for (let k = 1; k <= pos.length; k++) {
      const hasta = k < pos.length ? pos[k] : buf.length
      try { partes.push(zlib.zstdDecompressSync(buf.subarray(pos[desde], hasta)).toString('utf8')); desde = k } catch { if (k === pos.length) throw new Error('log de sesión dañado') }
    }
    texto = partes.join('')
  } else texto = buf.toString('utf8')
  const eventos = []
  for (const l of texto.split('\n')) { if (!l.trim()) continue; try { eventos.push(JSON.parse(l)) } catch {} }
  return eventos
}

const textoBloques = (content) => (Array.isArray(content) ? content : []).map((b) => b?.type === 'text' ? b.text : b?.type === 'image' ? '[imagen]' : '').filter(Boolean).join('\n').trim()

/** Convierte los eventos de una sesión en turnos { inicio, fin, turno, pedido, acciones[], respuesta }. */
export function turnosDeSesion(eventos) {
  const turnos = []
  let t = null
  const nuevo = (ev) => ({ inicio: ev?.time, turno: undefined, pedido: [], acciones: [], respuesta: [], llamadas: new Map() })
  for (const ev of eventos) {
    const d = ev?.data ?? {}
    if (ev.type === 'turn/start') { t ??= nuevo(ev); t.turno = d.turn; t.inicio ??= ev.time; continue }
    if (ev.type === 'user/message') {
      if (d.source?.kind !== 'user') continue
      t ??= nuevo(ev)
      const x = textoBloques(d.content); if (x) t.pedido.push(x)
      continue
    }
    if (!t) continue
    if (ev.type === 'assistant/message') {
      const x = textoBloques(d.message?.content); if (x) t.respuesta.push(x)
    } else if (ev.type === 'tool/call') {
      let args = d.arguments
      if (typeof args === 'string') { try { args = JSON.parse(args) } catch {} }
      t.llamadas.set(d.callId, t.acciones.length)
      t.acciones.push({ nombre: d.name, args, error: undefined })
    } else if (ev.type === 'tool/result') {
      const m = d.message ?? {}
      const i = t.llamadas.get(m.toolCallId ?? m.source?.callId)
      if (i !== undefined && (m.isError ?? d.isError)) t.acciones[i].error = textoBloques(m.content)
    } else if (ev.type === 'turn/end') {
      t.fin = ev.time; delete t.llamadas; turnos.push(t); t = null
    }
  }
  if (t && (t.pedido.length || t.acciones.length)) { delete t.llamadas; turnos.push(t) }
  return turnos
}

export function entradaDeTurno(t, sesion, cfg) {
  const f = hoy(new Date(t.inicio ?? Date.now()))
  const acciones = t.acciones.filter((a) => !String(a.nombre).startsWith('memoria_')).slice(0, 80)
    .map((a) => `- ${resumenHerramienta(a.nombre, a.args, a.error ? { isError: true, content: [{ text: a.error }] } : undefined)}`)
  return sinSecretos([
    `## ${f} · sesión ${String(sesion).slice(-8)} · importado`,
    t.pedido.length ? `**Pedido:**\n${corta(t.pedido.join('\n\n'), cfg.maxPedido)}` : '**Pedido:** (continuación)',
    acciones.length ? `**Acciones:**\n${acciones.join('\n')}` : '',
    t.respuesta.length ? `**Respuesta:**\n${corta(t.respuesta.at(-1), cfg.maxRespuesta)}` : '',
  ].filter(Boolean).join('\n\n'))
}

const mismaRuta = (a, b) => {
  const n = (p) => path.resolve(String(p ?? '')).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b)
}

/** Documentos que explican el proyecto: README, docs, configuración y esquemas. */
export async function leerDocumentos(cwd, max, archivoMemoria) {
  const candidatos = []
  const agregar = async (rel, limite = 15000) => {
    try {
      const f = path.join(cwd, rel)
      const s = await stat(f)
      if (!s.isFile() || s.size > 2_000_000) return
      let x = await readFile(f, 'utf8')
      if (rel === archivoMemoria) { const i = x.indexOf(INICIO); const j = x.indexOf(FIN); if (i >= 0 && j > i) x = x.slice(0, i) + x.slice(j + FIN.length) }
      if (rel === 'package.json') {
        try { const p = JSON.parse(x); x = JSON.stringify({ name: p.name, description: p.description, scripts: p.scripts, dependencies: p.dependencies, devDependencies: p.devDependencies }, null, 1) } catch {}
      }
      if (rel.startsWith('.env')) x = x.split('\n').map((l) => l.replace(/=.*/, '=…')).join('\n')
      if (x.trim()) candidatos.push(`### ${rel}\n${corta(x.trim(), limite)}`)
    } catch {}
  }
  for (const f of [archivoMemoria, 'CLAUDE.md', 'README.md', 'readme.md', 'README.es.md', 'LEEME.md', 'package.json', 'requirements.txt', 'pyproject.toml', 'composer.json',
    'prisma/schema.prisma', 'schema.sql', 'database.sql', 'supabase/schema.sql', 'docker-compose.yml', 'vercel.json', 'railway.json', '.env.example']) await agregar(f)
  for (const dir of ['docs', 'doc', 'documentacion', 'supabase/migrations', 'migrations', 'prisma/migrations', 'db']) {
    let lista = []
    try { lista = await readdir(path.join(cwd, dir), { recursive: true }) } catch { continue }
    for (const f of lista.filter((x) => /\.(md|txt|sql|prisma)$/i.test(x)).sort().slice(0, 40)) await agregar(path.join(dir, f).split(path.sep).join('/'), 8000)
  }
  let out = ''
  for (const c of candidatos) { if (out.length + c.length > max) break; out += `${c}\n\n` }
  return sinSecretos(out.trim())
}

// ---------- plugin ----------

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}), modelo: { ...DEFAULTS.modelo, ...(rawConfig?.modelo ?? {}) } }
  const estados = new WeakMap()
  const colas = new Map() // cwd -> promesa (serializa escrituras por proyecto)

  const estado = (agent) => {
    let s = estados.get(agent)
    if (!s) { s = nuevoTurno(); estados.set(agent, s) }
    return s
  }
  function nuevoTurno() { return { usuario: [], intentos: new Map(), orden: [], herramientas: [], escribio: false } }

  const cwdDe = (agent, signal) => ctx.workingDirectory.ensure(agent, signal)
  const enCola = (cwd, tarea) => {
    const prev = colas.get(cwd) ?? Promise.resolve()
    const p = prev.then(tarea, tarea)
    colas.set(cwd, p.catch(() => {}))
    return p
  }

  async function leerTexto(f) { try { return await readFile(f, 'utf8') } catch (e) { if (e?.code === 'ENOENT') return ''; throw e } }
  async function escribirAtomico(f, t) {
    await mkdir(path.dirname(f), { recursive: true })
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, t, 'utf8')
    await rename(tmp, f)
  }
  const rutaMemoria = (cwd) => path.join(cwd, cfg.archivoMemoria)
  const dirBitacora = (cwd) => path.join(cwd, cfg.carpeta, 'bitacora')

  async function leerBloque(cwd) {
    return extraerBloque(await leerTexto(rutaMemoria(cwd))) ?? ''
  }
  async function guardarBloque(cwd, bloque) {
    const f = rutaMemoria(cwd)
    const actual = await leerTexto(f)
    let b = sinSecretos(bloque)
    b = recortarSeguro(b, cfg.limiteDuro)
    await escribirAtomico(f, ponerBloque(actual, b))
    return b.length
  }

  // Si la memoria pasó del tamaño objetivo, Flash la condensa sin perder decisiones, reglas ni pendientes.
  async function compactarSiHaceFalta(cwd, sel, sessionId, signal) {
    const b = await leerBloque(cwd)
    if (!sel?.provider || b.length <= cfg.maxMemoria) return false
    await consolidar(cwd, [
      'INSTRUCCIÓN ESPECIAL: no hay turno nuevo. La memoria pasó del tamaño permitido.',
      `Condénsala a MENOS de ${cfg.maxMemoria} caracteres SIN perder ninguna decisión vigente, regla, preferencia ni pendiente abierto:`,
      'une viñetas repetidas, resume "Estado actual" y "Datos importantes", quita lo que quedó obsoleto o ya resuelto. No agregues nada nuevo.',
    ].join('\n'), sel, sessionId, signal, 'compactar')
    return true
  }
  async function asegurarIgnorar(cwd) {
    // La bitácora se guarda para ti; si usas git, decide si subirla. Creamos un README corto.
    const leeme = path.join(cwd, cfg.carpeta, 'LEEME.md')
    if (await leerTexto(leeme)) return
    await escribirAtomico(leeme, '# Memoria del proyecto (dsh-memoria)\n\n- `bitacora/`: registro detallado de cada turno de trabajo con el agente.\n- La memoria resumida está en el bloque "Memoria del proyecto" de `AGENTS.md`.\n- Si el repositorio es público, considera agregar esta carpeta a `.gitignore`.\n')
  }

  // ---- captura del turno ----

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      if (decision?.kind === 'enter' && payload.agent) {
        const s = estado(payload.agent)
        for (const m of decision.messages ?? []) {
          if (m?.source?.kind !== 'user') continue
          const t = textoDe(m)
          if (t) s.usuario.push(t)
        }
      }
    } catch { /* nunca romper el turno */ }
    return decision
  })

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    try {
      if (!agent || !frame) return
      const s = estado(agent)
      if (frame.type === 'start') {
        if (!s.intentos.has(frame.attemptId)) { s.intentos.set(frame.attemptId, ''); s.orden.push(frame.attemptId) }
        s.ultimoPorPaso ??= new Map()
        s.ultimoPorPaso.set(`${frame.turn}:${frame.step}`, frame.attemptId) // reintentos: vale el último
      } else if (frame.type === 'chunk' && frame.chunk?.type === 'text-delta') {
        s.intentos.set(frame.attemptId, (s.intentos.get(frame.attemptId) ?? '') + frame.chunk.text)
      }
    } catch {}
  })

  ctx.on('tools/result', (exec, result) => {
    try {
      if (!exec?.agent || exec.name?.startsWith('memoria_')) return
      const s = estado(exec.agent)
      if (s.herramientas.length < 80) s.herramientas.push(resumenHerramienta(exec.name, exec.arguments, result))
      if (ESCRIBE.test(exec.name) || EJECUTA.test(exec.name)) s.escribio = true
    } catch {}
  })

  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const s = estados.get(agent)
    if (!s) return
    estados.set(agent, nuevoTurno())
    const pedido = s.usuario.join('\n\n')
    const validos = new Set(s.ultimoPorPaso ? s.ultimoPorPaso.values() : s.orden)
    const respuesta = s.orden.filter((id) => validos.has(id)).map((id) => s.intentos.get(id)).filter((t) => t?.trim()).join('\n\n')
    if (!pedido && !s.herramientas.length && !respuesta) return
    let cwd
    try { cwd = await cwdDe(agent, signal) } catch { return }
    const sesion = agent.session?.id ?? ''
    const fecha = hoy()
    const entrada = sinSecretos([
      `## ${fecha}${sesion ? ` · sesión ${String(sesion).slice(-8)}` : ''}`,
      pedido ? `**Pedido:**\n${corta(pedido, cfg.maxPedido)}` : '**Pedido:** (continuación)',
      s.herramientas.length ? `**Acciones:**\n${s.herramientas.map((h) => `- ${h}`).join('\n')}` : '',
      respuesta ? `**Respuesta:**\n${corta(respuesta, cfg.maxRespuesta)}` : '',
    ].filter(Boolean).join('\n\n'))

    // 1) bitácora: siempre, rápido, sin LLM.
    try {
      await enCola(cwd, async () => {
        const f = path.join(dirBitacora(cwd), `${fecha.slice(0, 7)}.md`)
        await mkdir(path.dirname(f), { recursive: true })
        await asegurarIgnorar(cwd)
        await appendFile(f, `${entrada}\n\n`, 'utf8')
      })
    } catch (e) { ctx.logger?.warn?.(`memoria: no pude escribir la bitácora: ${e?.message ?? e}`) }

    // 2) memoria viva: en segundo plano, solo si hubo trabajo o un pedido sustancial.
    if (!cfg.consolidar) return
    if (!s.escribio && pedido.length < 60) return
    const sel = agent.model?.current?.()
    const provider = cfg.modelo.provider ?? sel?.provider
    if (!provider) return
    const selMem = { provider, model: cfg.modelo.model }
    enCola(cwd, async () => { await consolidar(cwd, `REGISTRO DEL ÚLTIMO TURNO:\n\n${entrada}`, selMem, sesion); await compactarSiHaceFalta(cwd, selMem, sesion) }).catch((e) => {
      ctx.logger?.warn?.(`memoria: no pude actualizar la memoria viva: ${e?.message ?? e}`)
    })
  })

  async function consolidar(cwd, registro, sel, sessionId, signal, minProporcion = 0.5) {
    const actual = (await leerBloque(cwd)) || bloqueVacio()
    const sinEncabezado = actual.includes(`### ${SECCIONES.proyecto}`) ? actual.slice(actual.indexOf(`### ${SECCIONES.proyecto}`)) : actual
    const timeout = AbortSignal.timeout(cfg.timeoutSegundos * 1000)
    const senal = signal ? AbortSignal.any([signal, timeout]) : timeout
    const stream = ctx.llm.stream({
      provider: sel.provider,
      model: sel.model,
      system: INSTRUCCION_CONSOLIDAR,
      ...(sessionId ? { sessionId } : {}),
      messages: [Object.freeze({
        role: 'user',
        source: { kind: 'user' },
        id: globalThis.crypto.randomUUID(),
        content: Object.freeze([{ type: 'text', text: `MEMORIA ACTUAL (máximo ${cfg.maxMemoria} caracteres al devolverla):\n\n${sinEncabezado}\n\n---\n\n${registro}` }]),
      })],
      signal: senal,
    })
    let texto = ''
    let fin
    for await (const c of stream) {
      if (c.type === 'text-delta') texto += c.text
      else if (c.type === 'finish') fin = c.reason
    }
    if (fin?.kind && fin.kind !== 'stop') throw new Error(fin.failure?.message ?? `el modelo terminó con ${fin.kind}`)
    const nuevo = limpiarRespuestaLLM(texto)
    if (!nuevo) throw new Error('el modelo no devolvió la memoria con el formato esperado; la dejé igual')
    // Protección: si la memoria nueva perdió más de la mitad, no confiar.
    const minimo = minProporcion === 'compactar' ? Math.min(sinEncabezado.length * 0.3, cfg.maxMemoria * 0.25) : sinEncabezado.length * minProporcion
    if (nuevo.length < minimo && sinEncabezado.length > 800) throw new Error('la memoria nueva era mucho más corta que la anterior; la dejé igual')
    // Si alguien anotó algo mientras corría el LLM, no se pierde: comparamos con lo que hay ahora.
    const ahora = (await leerBloque(cwd)) || bloqueVacio()
    let final = `${ENCABEZADO}\n\n${nuevo}`
    if (ahora !== actual) {
      const nuevasLineas = ahora.split('\n').filter((l) => l.startsWith('- ') && !actual.includes(l) && !final.includes(l))
      for (const l of nuevasLineas) final = anotarEnBloque(final, 'hecho', l.slice(2), hoy().slice(0, 10))
    }
    await guardarBloque(cwd, final)
  }

  // ---- herramientas ----

  const salidaTexto = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }

  ctx.tools.register({
    name: 'memoria_buscar',
    description:
      'Busca en la bitácora completa del proyecto (todas las conversaciones anteriores con el agente: pedidos, respuestas, archivos tocados, comandos y errores). ' +
      'Úsala ANTES de suponer cómo se hizo algo, por qué se decidió algo, qué archivo se cambió o qué error salió. Sin consulta devuelve lo más reciente.',
    parameters: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Palabras clave: nombre de archivo, función, tema, error, decisión' },
        max: { type: 'number', description: 'Entradas a devolver (por defecto 6, máximo 15)' },
      },
    },
    output: salidaTexto,
    async execute(args, exec) {
      const cwd = await cwdDe(exec.agent, exec.signal)
      let archivos = []
      try { archivos = (await readdir(dirBitacora(cwd))).filter((f) => /^\d{4}-\d{2}\.md$/.test(f)).sort() } catch {}
      if (!archivos.length) return 'La bitácora está vacía: todavía no hay turnos registrados en este proyecto.'
      const entradas = []
      for (const f of archivos) entradas.push(...partirEntradas(await readFile(path.join(dirBitacora(cwd), f), 'utf8')))
      const max = Math.max(1, Math.min(15, Number(args?.max) || 6))
      const res = buscarEntradas(entradas, args?.consulta ?? '', max)
      if (!res.length) return `Nada en la bitácora (${entradas.length} turnos registrados) coincide con "${args?.consulta}". Prueba otras palabras.`
      const out = res.map((x) => corta(x.e, 3500)).join('\n\n---\n\n')
      return corta(`${res.length} de ${entradas.length} turnos registrados${args?.consulta ? ` para "${args.consulta}"` : ' (los más recientes)'}:\n\n${out}`, 30000)
    },
  })

  ctx.tools.register({
    name: 'memoria_anotar',
    description:
      'Guarda AL INSTANTE algo en la memoria del proyecto (bloque de AGENTS.md), para que se recuerde en todas las conversaciones futuras. ' +
      'Úsala cuando el usuario diga "recuerda…", cuando se tome una decisión (con su porqué), se defina una regla o preferencia, quede algo pendiente o se resuelva un pendiente.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: [...Object.keys(SECCIONES), 'resuelto'], description: 'decision, regla, pendiente, resuelto (cierra un pendiente), estado, hecho, proyecto o stack' },
        texto: { type: 'string', description: 'Una frase clara y autosuficiente. En decisiones incluye el porqué.' },
      },
      required: ['tipo', 'texto'],
    },
    output: salidaTexto,
    async execute(args, exec) {
      const tipo = String(args?.tipo ?? 'hecho')
      const texto = sinSecretos(String(args?.texto ?? '').replace(/\s+/g, ' ').trim())
      if (!texto) throw new Error('"texto" está vacío')
      const cwd = await cwdDe(exec.agent, exec.signal)
      const fecha = hoy().slice(0, 10)
      await enCola(cwd, async () => {
        const b = await leerBloque(cwd)
        await guardarBloque(cwd, tipo === 'resuelto' ? resolverEnBloque(b || bloqueVacio(), texto, fecha) : anotarEnBloque(b, tipo, texto, fecha))
        const f = path.join(dirBitacora(cwd), `${hoy().slice(0, 7)}.md`)
        await mkdir(path.dirname(f), { recursive: true })
        await appendFile(f, `## ${hoy()} · anotación\n\n**${SECCIONES[tipo] ?? 'Resuelto'}:** ${texto}\n\n`, 'utf8')
      })
      const selA = exec.agent?.model?.current?.()
      const provA = cfg.modelo.provider ?? selA?.provider
      if (provA) enCola(cwd, () => compactarSiHaceFalta(cwd, { provider: provA, model: cfg.modelo.model }, exec.agent?.session?.id)).catch((e) => ctx.logger?.warn?.(`memoria: no pude condensar: ${e?.message ?? e}`))
      return `Guardado en la memoria del proyecto (${cfg.archivoMemoria} → ${tipo === 'resuelto' ? 'Estado actual' : SECCIONES[tipo] ?? SECCIONES.hecho}): ${texto}`
    },
  })

  ctx.tools.register({
    name: 'memoria_importar',
    description:
      'Recupera la memoria de un proyecto que ya venía trabajándose: lee TODAS las conversaciones anteriores de dsh en esta carpeta de proyecto y sus documentos ' +
      '(README, docs, AGENTS.md, package.json, esquemas y migraciones de base de datos), los pasa a la bitácora y arma la memoria viva con Flash, en orden cronológico. ' +
      'Úsala una vez al instalar el plugin en un proyecto existente, o cuando el usuario pida recuperar o reconstruir la memoria. Se puede repetir: solo agrega lo nuevo. Puede tardar unos minutos.',
    parameters: {
      type: 'object',
      properties: {
        documentos: { type: 'boolean', description: 'Leer también los documentos del proyecto. Por defecto true' },
        reconstruir: { type: 'boolean', description: 'Rehacer la memoria viva desde cero con toda la bitácora ya guardada, sin duplicarla (por defecto false: solo agrega lo nuevo). Úsalo si la memoria quedó incompleta o recortada.' },
      },
    },
    output: salidaTexto,
    timeoutMs: 30 * 60 * 1000,
    async execute(args, exec) {
      const cwd = await cwdDe(exec.agent, exec.signal)
      const actualId = exec.agent?.session?.id
      const home = cfg.dshHome ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
      const raiz = path.join(home, 'sessions')
      const fImport = path.join(cwd, cfg.carpeta, 'importado.json')
      let registro = {}
      try { registro = JSON.parse(await readFile(fImport, 'utf8')) } catch {}

      // 1) sesiones de esta carpeta
      const turnos = []
      let sesionesVistas = 0
      let carpetas = []
      try { carpetas = await readdir(raiz) } catch { }
      for (const c of carpetas) {
        let ses = []
        try { ses = (await readdir(path.join(raiz, c))).filter((x) => x.startsWith('session-')) } catch { continue }
        for (const s of ses) {
          if (s === actualId) continue
          let archivos = []
          try { archivos = (await readdir(path.join(raiz, c, s))).filter((x) => /^session\.v\d+\.jsonl(\.zstd)?$/.test(x)).sort() } catch { continue }
          const log = archivos.at(-1)
          if (!log) continue
          let eventos
          try { eventos = leerEventosSesion(await readFile(path.join(raiz, c, s, log)), log) } catch (e) { ctx.logger?.warn?.(`memoria: no pude leer ${s}: ${e?.message ?? e}`); continue }
          const cab = eventos.find((e) => e.type === 'session')
          if (!cab || !mismaRuta(cab.cwd, cwd)) continue
          sesionesVistas++
          const ya = registro[s] ?? 0
          const ts = turnosDeSesion(eventos)
          ts.slice(ya).forEach((t) => turnos.push({ t, s }))
          registro[s] = ts.length
        }
      }
      turnos.sort((a, b) => (a.t.inicio ?? 0) - (b.t.inicio ?? 0))
      const entradas = turnos.map(({ t, s }) => ({ fecha: hoy(new Date(t.inicio ?? Date.now())), texto: entradaDeTurno(t, s, cfg) }))

      // 2) documentos
      const docs = args?.documentos === false ? '' : await leerDocumentos(cwd, cfg.maxDocumentos, cfg.archivoMemoria)
      if (!entradas.length && !docs && !args?.reconstruir) {
        return `No encontré conversaciones nuevas de esta carpeta (${sesionesVistas} revisadas en ${raiz}) ni documentos del proyecto. Si las conversaciones están en otra carpeta de dsh, configura "dshHome".`
      }

      // 3) bitácora
      await enCola(cwd, async () => {
        const porMes = new Map()
        for (const e of entradas) { const m = e.fecha.slice(0, 7); porMes.set(m, (porMes.get(m) ?? '') + `${e.texto}\n\n`) }
        for (const [m, txt] of porMes) { const f = path.join(dirBitacora(cwd), `${m}.md`); await mkdir(path.dirname(f), { recursive: true }); await appendFile(f, txt, 'utf8') }
        await asegurarIgnorar(cwd)
        await escribirAtomico(fImport, JSON.stringify(registro, null, 1))
      })

      // 4) memoria viva con Flash, por lotes: primero documentos, luego historial en orden.
      const sel = exec.agent?.model?.current?.()
      const provider = cfg.modelo.provider ?? sel?.provider
      const lotes = []
      if (docs) lotes.push(`DOCUMENTOS DEL PROYECTO (úsalos para "Qué es el proyecto", "Stack y estructura", reglas y estado):\n\n${docs}`)
      // Al reconstruir se usa TODA la bitácora ya guardada (sin volver a escribirla); si no, solo lo nuevo.
      let historial = entradas.map((e) => e.texto)
      if (args?.reconstruir) {
        let archivos = []
        try { archivos = (await readdir(dirBitacora(cwd))).filter((f) => /^\d{4}-\d{2}\.md$/.test(f)).sort() } catch {}
        historial = []
        for (const f of archivos) historial.push(...partirEntradas(await readFile(path.join(dirBitacora(cwd), f), 'utf8')))
        historial.sort((a, b) => a.slice(3, 19).localeCompare(b.slice(3, 19)))
      }
      let lote = ''
      for (const texto of historial) {
        const e = { texto }
        if (lote && lote.length + e.texto.length > cfg.loteImportar) { lotes.push(`HISTORIAL DE CONVERSACIONES ANTERIORES (en orden cronológico; lo más reciente manda):\n\n${lote}`); lote = '' }
        lote += `${corta(e.texto, cfg.loteImportar)}\n\n`
      }
      if (lote) lotes.push(`HISTORIAL DE CONVERSACIONES ANTERIORES (en orden cronológico; lo más reciente manda):\n\n${lote}`)
      let hechos = 0; const fallos = []
      if (provider) {
        if (args?.reconstruir) await enCola(cwd, () => guardarBloque(cwd, bloqueVacio()))
        const usar = lotes.length > cfg.maxLotes ? [lotes[0], ...lotes.slice(-(cfg.maxLotes - 1))] : lotes
        for (const [k, l] of usar.entries()) {
          if (exec.signal?.aborted) break
          ctx.logger?.info?.(`memoria: importando lote ${k + 1} de ${usar.length}`)
          try { await enCola(cwd, () => consolidar(cwd, l, { provider, model: cfg.modelo.model }, actualId, exec.signal)); hechos++ } catch (e) { fallos.push(`lote ${k + 1}: ${e?.message ?? e}`) }
        }
        try { await enCola(cwd, () => compactarSiHaceFalta(cwd, { provider, model: cfg.modelo.model }, actualId, exec.signal)) } catch (e) { fallos.push(`condensar: ${e?.message ?? e}`) }
      }
      const b = await leerBloque(cwd)
      return [
        `Importé ${entradas.length} turnos nuevos de ${sesionesVistas} conversaciones anteriores de esta carpeta a la bitácora${args?.reconstruir ? ` y reconstruí la memoria con los ${historial.length} turnos de la bitácora` : ''}${docs ? ' y leí los documentos del proyecto' : ''}.`,
        provider ? `Memoria viva actualizada con ${hechos} de ${lotes.length} lotes${lotes.length > cfg.maxLotes ? ` (usé el primero y los ${cfg.maxLotes - 1} más recientes)` : ''}.` : 'No pude actualizar la memoria viva: no sé qué proveedor usar.',
        fallos.length ? `Fallos: ${fallos.join(' | ')}` : '',
        '',
        'Memoria viva actual:',
        corta(b, 12000),
        '',
        'Muéstrale al usuario un resumen y pregúntale si algo está mal o falta, para corregirlo con memoria_anotar.',
      ].filter((x) => x !== '').join('\n')
    },
  })

  ctx.tools.register({
    name: 'memoria_ver',
    description: 'Muestra la memoria viva del proyecto tal como está guardada ahora (la que se carga al inicio de cada conversación).',
    parameters: { type: 'object', properties: {} },
    output: salidaTexto,
    async execute(_args, exec) {
      const cwd = await cwdDe(exec.agent, exec.signal)
      const b = await leerBloque(cwd)
      return b ? `${cfg.archivoMemoria}:\n\n${b}` : `Todavía no hay memoria en ${cfg.archivoMemoria}. Se crea sola al terminar el primer turno con trabajo, con memoria_anotar, o recuperando las conversaciones anteriores y los documentos con memoria_importar.`
    },
  })
}
