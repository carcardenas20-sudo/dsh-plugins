// dsh-encargo — convierte un pedido corto en un encargo completo y verifica que se cumpla.
//
// 1. Cuando el usuario pide construir o cambiar algo, un analista (V4-Pro) lee el pedido junto
//    con la memoria del proyecto, el mapa del sistema y los criterios aprendidos, y escribe el
//    encargo: lo pedido con precisión, lo que NO se dijo pero se necesita, qué más se afecta y
//    una lista de "está terminado cuando…". Si hay una duda que cambia el resultado, una pregunta.
// 2. El agente recibe ese encargo junto al pedido y se lo resume al usuario antes de trabajar.
// 3. Al cerrar el turno, un verificador revisa la lista punto por punto contra lo que cambió.
//    Lo que falte, el agente lo completa antes de entregar.
// 4. Cuando el usuario corrige una omisión, se guarda como criterio del proyecto y entra en
//    todos los encargos siguientes.

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const name = 'encargo'
export const inject = ['tools', 'llm', 'workingDirectory', 'systemPrompt']

const DEFAULTS = {
  analista: { model: 'deepseek-v4-pro' }, // provider: por defecto el del agente
  modo: 'auto', // auto | siempre | nunca
  rondas: 2, // veces que devuelve el trabajo por puntos sin cumplir, por pedido
  carpeta: '.dsh-encargo',
  contexto: ['AGENTS.md', 'docs/MAPA-SISTEMA.md'], // archivos que el analista lee si existen
  maxContexto: 14000, // caracteres por archivo de contexto
  maxDiff: 60000,
  maxCriterios: 60,
  timeoutSegundos: 150,
}

const SOURCE_KIND = 'dsh-encargo'
const MUTA = /^(write|edit|multi_?edit|apply_?patch|create|str_replace|notebook_edit|patch)/i
const MAX_ARCHIVO = 400_000

// ---------- utilidades puras ----------

const ACCION = /(?<!\p{L})(haz|hazme|hacer|crea|crear|créame|agrega|agregar|añade|añadir|implementa|implementar|construye|construir|arma|armar|monta|corrige|corregir|arregla|arreglar|cambia|cambiar|modifica|modificar|actualiza|actualizar|quita|quitar|elimina|eliminar|borra|migra|migrar|integra|integrar|conecta|conectar|diseña|diseñar|refactoriza|mejora|mejorar|optimiza|termina|terminar|completa|completar|trae|traer|pasa|mueve|genera|generar|escribe|escribir|programa|desarrolla|necesito|quiero|falta|add|build|create|fix|implement|change|update|remove|refactor)(?!\p{L})/iu
const SEGUIMIENTO = /^(s[ií]|no|ok|okay|dale|listo|de una|hazlo|contin[uú]a|sigue|adelante|gracias|perfecto|bien|aprobado|apruebo|va|vale)(?!\p{L})[\s.,!¡]*$/iu
const OMISION = /(?<!\p{L})(te falt[oó]|falt[oó]|faltaron|olvidaste|se te (pas[oó]|olvid[oó])|no incluiste|no tuviste en cuenta|omitiste|debiste|no pusiste|no contemplaste|te salt(aste|ó))(?!\p{L})/iu

/** ¿Vale la pena ampliar este mensaje? */
export function ameritaEncargo(texto, modo = 'auto') {
  const t = String(texto ?? '').trim()
  if (modo === 'nunca' || !t) return false
  if (/\bsin encargo\b/i.test(t)) return false
  if (/\bcon encargo\b/i.test(t) || modo === 'siempre') return t.length >= 8
  if (t.length < 18 || SEGUIMIENTO.test(t)) return false
  if (!ACCION.test(t)) return false
  // Preguntas puras ("¿cómo funciona X?", "¿qué hace esto?") no son encargos.
  if (/^[¿\s]*(qu[eé]|c[oó]mo|por qu[eé]|cu[aá]l|cu[aá]ndo|d[oó]nde|qui[eé]n|explica|expl[ií]came)(?!\p{L})/iu.test(t) && /\?\s*$/.test(t) && !/\b(haz|crea|agrega|implementa|corrige|arregla|cambia)\b/i.test(t)) return false
  return true
}

export const senalaOmision = (texto) => OMISION.test(String(texto ?? ''))

export const INSTRUCCION_ANALISTA = [
  'Eres un analista de requisitos senior. Un usuario le pidió algo a un agente de programación con pocas palabras. Tu trabajo es escribir el ENCARGO COMPLETO: lo que una persona con mucho criterio entendería que hay que hacer, incluyendo lo que el usuario no dijo pero necesita para que el resultado sirva de verdad.',
  'Usa el contexto del proyecto (memoria, mapa del sistema, criterios aprendidos, estructura de carpetas). Las reglas y decisiones que aparezcan ahí mandan sobre tus suposiciones. No inventes requisitos que el contexto contradiga ni agrandes el alcance con funciones que nadie necesita.',
  'Piensa en: para qué lo quiere; validaciones y datos obligatorios; permisos y roles (quién puede ver o hacer esto); estados vacíos, de carga y de error; casos límite (duplicados, nulos, fechas, montos en cero o negativos); datos que ya existen y no se deben dañar; otras pantallas, tablas o procesos que se ven afectados; consistencia con lo que ya está construido (nombres, estilos, patrones); celular si hay interfaz; cómo se prueba.',
  'Responde SOLO con JSON válido, sin texto antes ni después:',
  '{"tipo": "construir" | "trivial", "pedido": "lo que se pide, en una o dos frases precisas", "implicitos": ["requisito no dicho pero necesario, concreto"], "afectados": ["archivo, pantalla, tabla o proceso que hay que revisar o tocar"], "terminado": ["condición verificable: está terminado cuando…"], "pregunta": null}',
  '"tipo" es "trivial" si el mensaje es una pregunta, una charla o un cambio mínimo que no necesita análisis (entonces deja las listas vacías).',
  '"implicitos": de 3 a 8, solo los que de verdad importan aquí. "terminado": de 4 a 9 condiciones que se puedan comprobar mirando el código o probándolo; incluye las de los implícitos importantes.',
  '"pregunta": SOLO si hay una duda cuya respuesta cambia de forma importante lo que se construye y el contexto no la resuelve; una sola pregunta, corta. En cualquier otro caso, null: decide tú lo razonable y déjalo en "implicitos".',
  'Escribe en español, frases cortas.',
].join('\n')

export const INSTRUCCION_VERIFICADOR = [
  'Eres un verificador de entregas. Un agente de programación recibió un encargo con una lista de condiciones de "terminado" y dice que acabó. Te doy la lista y los cambios que hizo en los archivos.',
  'Para CADA condición decide, solo con la evidencia de los cambios: "cumplido" (se ve hecho), "parcial" (empezado pero incompleto), "falta" (no hay rastro) o "no-aplica" (no corresponde a este trabajo, o no se puede comprobar mirando código, por ejemplo algo que solo se ve en ejecución).',
  'Sé justo: no marques "falta" por estilo o por detalles que la condición no pide. Si la condición pudo quedar cumplida por código que ya existía y no aparece en los cambios, usa "no-aplica".',
  'Responde SOLO con JSON válido: {"puntos": [{"n": 1, "estado": "cumplido" | "parcial" | "falta" | "no-aplica", "nota": "qué falta exactamente, en una frase (vacío si cumplido)"}]}',
  'Escribe en español.',
].join('\n')

function extraerJSON(texto) {
  const t = String(texto ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const i = t.indexOf('{'), j = t.lastIndexOf('}')
  if (i < 0 || j < i) return null
  try { return JSON.parse(t.slice(i, j + 1)) } catch { return null }
}
const limpiaLista = (v, max) => (Array.isArray(v) ? v : []).map((x) => String(x ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, max)

export function leerEncargo(texto) {
  const v = extraerJSON(texto)
  if (!v) return null
  const e = {
    tipo: v.tipo === 'trivial' ? 'trivial' : 'construir',
    pedido: String(v.pedido ?? '').trim(),
    implicitos: limpiaLista(v.implicitos, 10),
    afectados: limpiaLista(v.afectados, 12),
    terminado: limpiaLista(v.terminado, 12),
    pregunta: typeof v.pregunta === 'string' && v.pregunta.trim() ? v.pregunta.trim() : null,
  }
  if (e.tipo === 'construir' && !e.terminado.length) return null
  return e
}

export function leerVerificacion(texto, total) {
  const v = extraerJSON(texto)
  if (!v || !Array.isArray(v.puntos)) return null
  const ok = new Set(['cumplido', 'parcial', 'falta', 'no-aplica'])
  return v.puntos
    .map((p) => ({ n: Number(p?.n), estado: ok.has(p?.estado) ? p.estado : 'no-aplica', nota: String(p?.nota ?? '').trim() }))
    .filter((p) => Number.isInteger(p.n) && p.n >= 1 && p.n <= total)
}

export function textoEncargo(e) {
  const l = [`ENCARGO: ${e.pedido}`]
  if (e.implicitos.length) l.push('', 'No se dijo, pero se necesita:', ...e.implicitos.map((x) => `- ${x}`))
  if (e.afectados.length) l.push('', 'Revisar o tocar también:', ...e.afectados.map((x) => `- ${x}`))
  l.push('', 'Está terminado cuando:', ...e.terminado.map((x, i) => `${i + 1}. ${x}`))
  if (e.pregunta) l.push('', `Duda que cambia el resultado: ${e.pregunta}`)
  return l.join('\n')
}

/** Diferencia legible entre dos versiones: recorta lo común al inicio y al final. */
export function diferencia(ruta, antes, despues, maxLineas = 300) {
  if (antes === despues) return ''
  if (despues == null) return `--- (archivo borrado) ${ruta}`
  const b = despues.split('\n')
  if (antes == null) return `--- (archivo nuevo) ${ruta}\n${b.slice(0, maxLineas).map((x) => `+ ${x}`).join('\n')}${b.length > maxLineas ? `\n… (${b.length - maxLineas} líneas más)` : ''}`
  const a = antes.split('\n')
  let ini = 0
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++
  let fa = a.length - 1, fb = b.length - 1
  while (fa >= ini && fb >= ini && a[fa] === b[fb]) { fa--; fb-- }
  const out = [`--- ${ruta} (desde la línea ${ini + 1})`]
  a.slice(ini, fa + 1).slice(0, maxLineas).forEach((x) => out.push(`- ${x}`))
  b.slice(ini, fb + 1).slice(0, maxLineas).forEach((x) => out.push(`+ ${x}`))
  return out.join('\n')
}

export function criteriosDe(texto) {
  return String(texto ?? '').split('\n').map((l) => /^-\s+(.*)$/.exec(l.trim())?.[1]?.trim()).filter(Boolean)
}
const criteriosAMd = (lista) => `# Criterios del proyecto (dsh-encargo)\n\nCosas que el usuario ha pedido tener siempre en cuenta. Se incluyen en cada encargo. Puedes editar este archivo.\n\n${lista.map((c) => `- ${c}`).join('\n')}\n`

const deepFreeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v) } return v }
const mensaje = (text, form, summary) => deepFreeze({ role: 'user', id: globalThis.crypto.randomUUID(), content: [{ type: 'text', text }], source: { kind: SOURCE_KIND, form, ...(summary ? { summary: summary.slice(0, 120) } : {}) } })
const textoDe = (m) => (m?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim()

const REGLAS = [
  '## Encargo (dsh-encargo)',
  'When a message tagged [Encargo] accompanies the user request, it is the full brief for that request, written by an analyst from the project memory, system map and learned criteria. Treat it as the definition of done:',
  '1. Start your reply with a short "Encargo" summary for the user (3-6 lines, Spanish): what you understood, the most important unstated requirements you will cover, and anything you will NOT do. If the brief contains a "Duda que cambia el resultado", ask that single question and stop until the user answers.',
  '2. Do the work covering every "Está terminado cuando" item. If you decide an item should not be done, say so explicitly with the reason; never skip it silently.',
  '3. Before finishing, go through the list and state the result of each item in one line.',
  'When the user points out something you missed or forgot, fix it and then call encargo_criterio (accion "agregar") with a general, reusable rule for this project (not the specific case), so it is never missed again.',
].join('\n')

// ---------- plugin ----------

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}), analista: { ...DEFAULTS.analista, ...(rawConfig?.analista ?? {}) } }
  const estados = new WeakMap()
  const estado = (agent) => { let s = estados.get(agent); if (!s) { s = { encargo: null, antes: new Map(), rondas: 0, firma: null }; estados.set(agent, s) } return s }

  ctx.systemPrompt.section({ name: 'encargo', order: 2440, interpolate: false, text: REGLAS })

  const leer = async (f) => { try { const s = await stat(f); if (s.size > MAX_ARCHIVO) return undefined; return await readFile(f, 'utf8') } catch (e) { return e?.code === 'ENOENT' ? null : undefined } }
  const archivoCriterios = (cwd) => path.join(cwd, cfg.carpeta, 'criterios.md')
  const leerCriterios = async (cwd) => criteriosDe(await leer(archivoCriterios(cwd)))
  async function guardarCriterios(cwd, lista) {
    await mkdir(path.join(cwd, cfg.carpeta), { recursive: true })
    await writeFile(archivoCriterios(cwd), criteriosAMd(lista.slice(-cfg.maxCriterios)), 'utf8')
  }

  async function arbol(cwd) {
    const omitir = new Set(['node_modules', '.git', 'target', 'build', 'dist', '.venv', '__pycache__', '.idea', '.vscode', '_referencia', cfg.carpeta, '.dsh-memoria', '.dsh-planes'])
    const out = []
    const andar = async (dir, nivel) => {
      let ents
      try { ents = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
        if (out.length >= 140 || omitir.has(e.name) || e.name.startsWith('.')) continue
        out.push(`${'  '.repeat(nivel)}${e.name}${e.isDirectory() ? '/' : ''}`)
        if (e.isDirectory() && nivel < 2) await andar(path.join(dir, e.name), nivel + 1)
      }
    }
    await andar(cwd, 0)
    return out.join('\n')
  }

  async function llamar(agent, signal, system, texto) {
    const sel = agent.model?.current?.()
    const provider = cfg.analista.provider ?? sel?.provider
    if (!provider) throw new Error('no sé qué proveedor usar')
    const timeout = AbortSignal.timeout(cfg.timeoutSegundos * 1000)
    const stream = ctx.llm.stream({
      provider, model: cfg.analista.model, system,
      ...(agent.session?.id ? { sessionId: agent.session.id } : {}),
      messages: [deepFreeze({ role: 'user', id: globalThis.crypto.randomUUID(), source: { kind: 'user' }, content: [{ type: 'text', text: texto }] })],
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    let out = ''
    let fin
    for await (const c of stream) { if (c.type === 'text-delta') out += c.text; else if (c.type === 'finish') fin = c.reason }
    if (fin?.kind && fin.kind !== 'stop') throw new Error(fin.failure?.message ?? `terminó con ${fin.kind}`)
    return out
  }

  async function analizar(agent, signal, cwd, pedido) {
    const partes = [`PEDIDO DEL USUARIO:\n"""${pedido.slice(0, 6000)}"""`]
    const criterios = await leerCriterios(cwd)
    if (criterios.length) partes.push(`CRITERIOS APRENDIDOS DE ESTE PROYECTO (el usuario ya corrigió estas omisiones; inclúyelos siempre que apliquen):\n${criterios.map((c) => `- ${c}`).join('\n')}`)
    for (const rel of cfg.contexto) {
      const t = await leer(path.join(cwd, rel))
      if (t) partes.push(`CONTEXTO — ${rel}:\n${t.length > cfg.maxContexto ? `${t.slice(0, cfg.maxContexto)}\n… (recortado)` : t}`)
    }
    const a = await arbol(cwd)
    if (a) partes.push(`ESTRUCTURA DEL PROYECTO:\n${a}`)
    const e = leerEncargo(await llamar(agent, signal, INSTRUCCION_ANALISTA, partes.join('\n\n')))
    if (!e) throw new Error('el analista no respondió en el formato esperado')
    return e
  }

  async function cambios(s) {
    const partes = []
    for (const [abs, { rel, contenido }] of s.antes) {
      if (contenido === undefined) continue
      const ahora = await leer(abs)
      if (ahora === undefined) continue
      const d = diferencia(rel, contenido, ahora)
      if (d) partes.push(d)
    }
    return partes
  }

  async function verificar(agent, signal, s, partes) {
    let diff = partes.join('\n\n')
    if (diff.length > cfg.maxDiff) diff = `${diff.slice(0, cfg.maxDiff)}\n… (recortado)`
    const texto = [
      `ENCARGO: ${s.encargo.pedido}`,
      `\nCONDICIONES DE TERMINADO:\n${s.encargo.terminado.map((x, i) => `${i + 1}. ${x}`).join('\n')}`,
      `\nCAMBIOS HECHOS (líneas con "-" se quitaron, con "+" se agregaron):\n\n${diff}`,
    ].join('\n')
    const puntos = leerVerificacion(await llamar(agent, signal, INSTRUCCION_VERIFICADOR, texto), s.encargo.terminado.length)
    if (!puntos) throw new Error('el verificador no respondió en el formato esperado')
    return puntos
  }

  const pendientesTxt = (s, puntos) => puntos.filter((p) => p.estado === 'falta' || p.estado === 'parcial')
    .map((p) => `${p.n}. [${p.estado === 'falta' ? 'FALTA' : 'INCOMPLETO'}] ${s.encargo.terminado[p.n - 1]}${p.nota ? `\n   → ${p.nota}` : ''}`)

  // Pedido nuevo: se amplía antes de que el agente empiece.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter' || !payload.agent) return decision
    try {
      const pedido = (decision.messages ?? []).filter((m) => m?.source?.kind === 'user').map(textoDe).filter(Boolean).join('\n\n')
      if (!pedido) return decision
      const s = estado(payload.agent)
      s.rondas = 0
      const extra = []
      if (ameritaEncargo(pedido, cfg.modo)) {
        const cwd = await ctx.workingDirectory.ensure(payload.agent, payload.signal)
        const e = await analizar(payload.agent, payload.signal, cwd, pedido)
        if (e.tipo === 'construir') {
          s.encargo = e; s.antes = new Map(); s.firma = null
          const txt = textoEncargo(e)
          try { await mkdir(path.join(cwd, cfg.carpeta), { recursive: true }); await writeFile(path.join(cwd, cfg.carpeta, 'ultimo.md'), `# Último encargo\n\nPedido original: ${pedido.replace(/\n+/g, ' ').slice(0, 500)}\n\n${txt}\n`, 'utf8') } catch {}
          extra.push(`[Encargo] Este es el encargo completo del pedido anterior del usuario, preparado por un analista con la memoria, el mapa y los criterios del proyecto. Es tu definición de terminado: resúmeselo al usuario al empezar y cúmplelo punto por punto.${e.pregunta ? ' Trae una duda: hazle esa única pregunta al usuario y espera su respuesta antes de construir.' : ''}\n\n${txt}`)
        }
      }
      if (senalaOmision(pedido)) extra.push('[Encargo] El usuario está señalando algo que se omitió. Corrígelo y luego llama encargo_criterio (accion "agregar") con una regla general y reutilizable para este proyecto, para que no vuelva a pasar.')
      if (!extra.length) return decision
      const msgs = [...decision.messages]
      let i = -1
      msgs.forEach((m, k) => { if (m?.source?.kind === 'user') i = k })
      msgs.splice(i + 1, 0, ...extra.map((t) => mensaje(t, 'recall')))
      return { ...decision, messages: msgs }
    } catch (e) {
      ctx.logger?.warn?.(`encargo: no se pudo preparar (${e?.message ?? e})`)
      return decision
    }
  })

  // Guardar cómo estaba cada archivo antes de que el agente lo cambie.
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const s = exec?.agent && estados.get(exec.agent)
      if (s?.encargo && MUTA.test(exec.name ?? '')) {
        const a = exec.arguments ?? {}
        const r = a.file_path ?? a.path ?? a.filePath ?? a.file ?? a.target
        if (typeof r === 'string' && r) {
          const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
          const abs = path.resolve(cwd, r)
          if (!s.antes.has(abs)) s.antes.set(abs, { rel: path.relative(cwd, abs).split(path.sep).join('/'), contenido: await leer(abs) })
        }
      }
    } catch {}
    return next()
  })

  // Al cerrar el turno: ¿se cumplió la lista?
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const s = estados.get(agent)
    if (!s?.encargo || !s.antes.size || s.rondas >= cfg.rondas) return
    try {
      const partes = await cambios(s)
      if (!partes.length) return
      const firma = `${partes.join('\n').length}:${partes.join('\n').slice(-200)}`
      if (firma === s.firma) return
      s.firma = firma
      const puntos = await verificar(agent, signal, s, partes)
      if (signal?.aborted) return
      const faltan = pendientesTxt(s, puntos)
      if (!faltan.length) { ctx.logger?.info?.('encargo: lista cumplida'); return }
      s.rondas++
      agent.steer(mensaje([
        `[Encargo] Antes de entregar: un verificador revisó la lista de "terminado" contra tus cambios y ${faltan.length} punto(s) no se cumplen todavía:`,
        '',
        ...faltan,
        '',
        'Complétalos ahora. Si un punto no se debe hacer o ya está cubierto por código que no tocaste, no lo fuerces: dile al usuario en una línea por qué. Al final dile al usuario qué completaste por esta verificación.',
        s.rondas >= cfg.rondas ? '(Es la última verificación para este pedido.)' : '',
      ].filter(Boolean).join('\n'), 'notice', `Encargo: ${faltan.length} punto(s) por completar`))
    } catch (e) {
      ctx.logger?.warn?.(`encargo: no se pudo verificar (${e?.message ?? e})`)
    }
  })

  const salida = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }

  ctx.tools.register({
    name: 'encargo_ver',
    description: 'Muestra el encargo vigente de este pedido (lo pedido, lo implícito, lo afectado y la lista de "terminado"). Con verificar=true, además comprueba ahora la lista contra los cambios hechos.',
    parameters: { type: 'object', properties: { verificar: { type: 'boolean' } } },
    output: salida,
    timeoutMs: (DEFAULTS.timeoutSegundos + 30) * 1000,
    async execute(args, exec) {
      const s = exec?.agent && estados.get(exec.agent)
      if (!s?.encargo) return 'No hay un encargo vigente en esta conversación. Se crea solo cuando el usuario pide construir o cambiar algo (o si escribe "con encargo").'
      let txt = textoEncargo(s.encargo)
      if (args?.verificar) {
        const partes = await cambios(s)
        if (!partes.length) return `${txt}\n\nTodavía no hay cambios en archivos para verificar.`
        const puntos = await verificar(exec.agent, exec.signal, s, partes)
        txt += `\n\nVerificación:\n${puntos.map((p) => `${p.n}. ${p.estado}${p.nota ? ` — ${p.nota}` : ''}`).join('\n')}`
      }
      return txt
    },
  })

  ctx.tools.register({
    name: 'encargo_criterio',
    description: 'Criterios del proyecto: reglas generales que el usuario quiere que SIEMPRE se tengan en cuenta (nacen de omisiones que corrigió). Se incluyen en todos los encargos futuros. accion: "agregar" (texto), "listar", "quitar" (numero). Agrega uno cada vez que el usuario señale algo que se te pasó, redactado como regla general, no como el caso puntual.',
    parameters: {
      type: 'object',
      properties: {
        accion: { type: 'string', enum: ['agregar', 'listar', 'quitar'] },
        texto: { type: 'string', description: 'La regla, en una frase. Ej.: "Toda pantalla con listado debe filtrar por la sede del usuario."' },
        numero: { type: 'number', description: 'Para quitar: el número que muestra "listar"' },
      },
      required: ['accion'],
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const lista = await leerCriterios(cwd)
      const ver = (l) => (l.length ? l.map((c, i) => `${i + 1}. ${c}`).join('\n') : 'Todavía no hay criterios.')
      if (args.accion === 'listar') return ver(lista)
      if (args.accion === 'quitar') {
        const n = Number(args.numero)
        if (!Number.isInteger(n) || n < 1 || n > lista.length) throw new Error(`"numero" debe estar entre 1 y ${lista.length}`)
        const [q] = lista.splice(n - 1, 1)
        await guardarCriterios(cwd, lista)
        return `Quitado: ${q}\n\n${ver(lista)}`
      }
      const t = String(args.texto ?? '').replace(/\s+/g, ' ').trim()
      if (t.length < 12) throw new Error('"texto" debe ser una regla completa')
      if (lista.some((c) => c.toLowerCase() === t.toLowerCase())) return `Ese criterio ya estaba.\n\n${ver(lista)}`
      lista.push(t.slice(0, 400))
      await guardarCriterios(cwd, lista)
      return `Criterio guardado en ${cfg.carpeta}/criterios.md. Se tendrá en cuenta en los próximos encargos.\n\n${ver(lista.slice(-cfg.maxCriterios))}`
    },
  })
}
