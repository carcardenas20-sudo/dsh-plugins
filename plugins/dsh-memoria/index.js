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
//      memoria_ver (muestra la memoria viva).

import { mkdir, readFile, writeFile, rename, appendFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export const name = 'memoria'
export const inject = ['tools', 'llm', 'workingDirectory']

const DEFAULTS = {
  carpeta: '.dsh-memoria',
  archivoMemoria: 'AGENTS.md',
  modelo: { model: 'deepseek-flash' }, // provider: por defecto el del agente
  consolidar: true, // actualizar la memoria viva con Flash al cerrar turnos con trabajo
  maxMemoria: 12000, // caracteres máximos del bloque de memoria viva
  maxPedido: 4000,
  maxRespuesta: 3000,
  timeoutSegundos: 90,
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
    if (b.length > cfg.maxMemoria * 1.5) b = b.slice(0, cfg.maxMemoria * 1.5) + '\n- (memoria recortada por tamaño)'
    await escribirAtomico(f, ponerBloque(actual, b))
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
    enCola(cwd, () => consolidar(cwd, entrada, { provider, model: cfg.modelo.model }, sesion)).catch((e) => {
      ctx.logger?.warn?.(`memoria: no pude actualizar la memoria viva: ${e?.message ?? e}`)
    })
  })

  async function consolidar(cwd, entrada, sel, sessionId) {
    const actual = (await leerBloque(cwd)) || bloqueVacio()
    const sinEncabezado = actual.includes(`### ${SECCIONES.proyecto}`) ? actual.slice(actual.indexOf(`### ${SECCIONES.proyecto}`)) : actual
    const timeout = AbortSignal.timeout(cfg.timeoutSegundos * 1000)
    const stream = ctx.llm.stream({
      provider: sel.provider,
      model: sel.model,
      system: INSTRUCCION_CONSOLIDAR,
      ...(sessionId ? { sessionId } : {}),
      messages: [Object.freeze({
        role: 'user',
        source: { kind: 'user' },
        id: globalThis.crypto.randomUUID(),
        content: Object.freeze([{ type: 'text', text: `MEMORIA ACTUAL (máximo ${cfg.maxMemoria} caracteres al devolverla):\n\n${sinEncabezado}\n\n---\n\nREGISTRO DEL ÚLTIMO TURNO:\n\n${entrada}` }]),
      })],
      signal: timeout,
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
    if (nuevo.length < sinEncabezado.length * 0.5 && sinEncabezado.length > 800) throw new Error('la memoria nueva era mucho más corta que la anterior; la dejé igual')
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
      return `Guardado en la memoria del proyecto (${cfg.archivoMemoria} → ${tipo === 'resuelto' ? 'Estado actual' : SECCIONES[tipo] ?? SECCIONES.hecho}): ${texto}`
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
      return b ? `${cfg.archivoMemoria}:\n\n${b}` : `Todavía no hay memoria en ${cfg.archivoMemoria}. Se crea sola al terminar el primer turno con trabajo, o con memoria_anotar.`
    },
  })
}
