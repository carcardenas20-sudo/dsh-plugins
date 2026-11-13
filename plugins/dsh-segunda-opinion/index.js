// dsh-segunda-opinion — un segundo cerebro revisa el trabajo antes de entregarlo.
//
// 1. Antes de que el agente modifique un archivo, se guarda cómo estaba.
// 2. Cuando el agente intenta cerrar el turno, el plugin arma el "antes y después" de lo que
//    cambió y se lo da a OTRO modelo (V4-Pro por defecto) con lo que pidió el usuario, para que
//    lo revise como un revisor exigente: errores de lógica, casos sin cubrir, cosas que rompió,
//    seguridad. No opina de estilo.
// 3. Si encuentra problemas importantes, el agente los tiene que corregir (o explicar por qué
//    el revisor se equivoca) antes de entregar. Si todo está bien, pasa en silencio.

import { readFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'

export const name = 'segunda-opinion'
export const inject = ['tools', 'llm', 'workingDirectory']

const DEFAULTS = {
  revisor: { model: 'deepseek-v4-pro' }, // provider: por defecto el del agente
  rondas: 2, // máximo de veces que devuelve el trabajo en un mismo pedido
  minLineas: 4, // no revisar cambios más pequeños que esto
  revisarDocs: false, // revisar también .md/.txt
  maxDiff: 60000, // caracteres de cambios que se mandan al revisor
  timeoutSegundos: 180,
  gravedadMinima: 'media', // 'alta' = solo devuelve por problemas graves
}

const SOURCE_KIND = 'dsh-segunda-opinion'
const MUTA = /^(write|edit|multi_?edit|apply_?patch|create|str_replace|notebook_edit|patch)/i
const DOCS = /\.(md|mdx|txt|rst|log)$/i
const MAX_ARCHIVO = 400_000
const ORDEN = { alta: 3, media: 2, baja: 1 }

// ---------- utilidades puras ----------

/** Diferencia legible entre dos versiones: recorta lo común al inicio y al final. */
export function diferencia(ruta, antes, despues, contexto = 3, maxLineas = 400) {
  if (antes === despues) return ''
  if (antes == null) {
    const l = despues.split('\n')
    return `--- (archivo nuevo) ${ruta}\n${l.slice(0, maxLineas).map((x, i) => `+${String(i + 1).padStart(4)} ${x}`).join('\n')}${l.length > maxLineas ? `\n… (${l.length - maxLineas} líneas más)` : ''}`
  }
  if (despues == null) return `--- (archivo borrado) ${ruta}`
  const a = antes.split('\n'), b = despues.split('\n')
  let ini = 0
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++
  let fa = a.length - 1, fb = b.length - 1
  while (fa >= ini && fb >= ini && a[fa] === b[fb]) { fa--; fb-- }
  const desde = Math.max(0, ini - contexto)
  const out = [`--- ${ruta} (líneas ${ini + 1}–${fb + 1} en la versión nueva)`]
  for (let i = desde; i < ini; i++) out.push(`  ${String(i + 1).padStart(4)} ${a[i]}`)
  const quitadas = a.slice(ini, fa + 1), puestas = b.slice(ini, fb + 1)
  quitadas.slice(0, maxLineas).forEach((x, k) => out.push(`- ${String(ini + k + 1).padStart(4)} ${x}`))
  if (quitadas.length > maxLineas) out.push(`- … (${quitadas.length - maxLineas} líneas quitadas más)`)
  puestas.slice(0, maxLineas).forEach((x, k) => out.push(`+ ${String(ini + k + 1).padStart(4)} ${x}`))
  if (puestas.length > maxLineas) out.push(`+ … (${puestas.length - maxLineas} líneas nuevas más)`)
  for (let i = fb + 1; i < Math.min(b.length, fb + 1 + contexto); i++) out.push(`  ${String(i + 1).padStart(4)} ${b[i]}`)
  return out.join('\n')
}

export const lineasCambiadas = (d) => d.split('\n').filter((l) => /^[+-] /.test(l) || /^\+\s*\d/.test(l)).length

export const INSTRUCCION = [
  'Eres un revisor de código senior, exigente y justo. Otro agente acaba de hacer estos cambios para cumplir el pedido del usuario. Tu trabajo es encontrar problemas REALES antes de que el usuario los reciba.',
  'Busca, en este orden:',
  '1. Errores de lógica o cálculos mal hechos; casos que no se contemplan (vacíos, nulos, ceros, negativos, listas vacías, fechas, mayúsculas, concurrencia).',
  '2. Cosas que el cambio rompe: llamadas a funciones que cambiaron de firma, imports, nombres, tipos, comportamiento que otra parte del código espera.',
  '3. Que el cambio NO cumpla lo que pidió el usuario, o lo cumpla a medias.',
  '4. Seguridad: datos sin validar, inyección SQL, claves expuestas, permisos.',
  '5. Manejo de errores ausente donde puede fallar (red, archivos, base de datos).',
  'NO comentes estilo, nombres, formato ni preferencias. NO pidas pruebas o documentación salvo que su falta esconda un error. Si no estás seguro de que algo es un problema, no lo reportes.',
  'Responde SOLO con JSON válido, sin texto antes ni después:',
  '{"veredicto": "aprobado" | "cambios", "resumen": "una frase", "problemas": [{"gravedad": "alta" | "media" | "baja", "archivo": "ruta", "linea": 0, "problema": "qué está mal y por qué, concreto", "arreglo": "qué hacer"}]}',
  'Gravedad alta: hace que algo falle, dé resultados equivocados o sea inseguro. Media: falla en casos razonables o rompe algo secundario. Baja: detalle menor. "veredicto" es "cambios" solo si hay problemas alta o media.',
  'Escribe en español.',
].join('\n')

export function leerVeredicto(texto) {
  let t = String(texto ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const i = t.indexOf('{'), j = t.lastIndexOf('}')
  if (i < 0 || j < i) return null
  try {
    const v = JSON.parse(t.slice(i, j + 1))
    const problemas = (Array.isArray(v.problemas) ? v.problemas : [])
      .filter((p) => p && typeof p.problema === 'string')
      .map((p) => ({ gravedad: ORDEN[p.gravedad] ? p.gravedad : 'media', archivo: String(p.archivo ?? ''), linea: Number(p.linea) || null, problema: p.problema, arreglo: String(p.arreglo ?? '') }))
    return { veredicto: v.veredicto === 'cambios' ? 'cambios' : 'aprobado', resumen: String(v.resumen ?? ''), problemas }
  } catch { return null }
}

const deepFreeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v) } return v }
const aviso = (text, summary) => deepFreeze({ role: 'user', id: globalThis.crypto.randomUUID(), content: [{ type: 'text', text }], source: { kind: SOURCE_KIND, form: 'notice', summary: summary.slice(0, 120) } })

// ---------- plugin ----------

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}), revisor: { ...DEFAULTS.revisor, ...(rawConfig?.revisor ?? {}) } }
  const estados = new WeakMap()
  const nuevo = () => ({ pedido: [], antes: new Map(), rondas: 0, ultimaFirma: null, previos: [] })
  const estado = (agent) => { let s = estados.get(agent); if (!s) { s = nuevo(); estados.set(agent, s) } return s }

  const rutaDe = (args) => args?.file_path ?? args?.path ?? args?.filePath ?? args?.file ?? args?.target
  const leer = async (f) => { try { const s = await stat(f); if (s.size > MAX_ARCHIVO) return undefined; return await readFile(f, 'utf8') } catch (e) { return e?.code === 'ENOENT' ? null : undefined } }

  // Nuevo pedido del usuario: empieza un ciclo de revisión limpio.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      if (decision?.kind === 'enter' && payload.agent) {
        const delUsuario = (decision.messages ?? []).filter((m) => m?.source?.kind === 'user')
        if (delUsuario.length) {
          const s = nuevo()
          for (const m of delUsuario) s.pedido.push((m.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n'))
          estados.set(payload.agent, s)
        }
      }
    } catch {}
    return decision
  })

  // Antes de que el agente modifique un archivo, guardamos cómo estaba.
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      if (exec?.agent && MUTA.test(exec.name ?? '')) {
        const r = rutaDe(exec.arguments)
        if (typeof r === 'string' && r) {
          const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
          const abs = path.resolve(cwd, r)
          const s = estado(exec.agent)
          if (!s.antes.has(abs)) s.antes.set(abs, { rel: path.relative(cwd, abs).split(path.sep).join('/'), contenido: await leer(abs) })
        }
      }
    } catch {}
    return next()
  })

  async function cambios(agent, signal) {
    const s = estado(agent)
    const partes = []
    for (const [abs, { rel, contenido }] of s.antes) {
      if (contenido === undefined) continue // muy grande o ilegible
      if (!cfg.revisarDocs && DOCS.test(rel)) continue
      const ahora = await leer(abs)
      if (ahora === undefined) continue
      const d = diferencia(rel, contenido, ahora)
      if (d) partes.push(d)
    }
    return partes
  }

  async function revisar(agent, signal, partes, pedido, previos) {
    const sel = agent.model?.current?.()
    const provider = cfg.revisor.provider ?? sel?.provider
    if (!provider) throw new Error('no sé qué proveedor usar para el revisor')
    let diff = partes.join('\n\n')
    if (diff.length > cfg.maxDiff) diff = `${diff.slice(0, cfg.maxDiff)}\n… (cambios recortados por tamaño)`
    const texto = [
      `PEDIDO DEL USUARIO:\n"""${String(pedido).slice(0, 6000)}"""`,
      previos.length ? `\nESTA ES UNA SEGUNDA REVISIÓN. En la anterior reportaste:\n${previos.map((p) => `- [${p.gravedad}] ${p.archivo}: ${p.problema}`).join('\n')}\nVerifica si quedaron corregidos. No inventes problemas nuevos menores.` : '',
      `\nCAMBIOS (líneas con "-" se quitaron, con "+" se agregaron, el número es la línea):\n\n${diff}`,
    ].join('\n')
    const timeout = AbortSignal.timeout(cfg.timeoutSegundos * 1000)
    const stream = ctx.llm.stream({
      provider, model: cfg.revisor.model, system: INSTRUCCION,
      ...(agent.session?.id ? { sessionId: agent.session.id } : {}),
      messages: [deepFreeze({ role: 'user', id: globalThis.crypto.randomUUID(), source: { kind: 'user' }, content: [{ type: 'text', text: texto }] })],
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    let out = ''
    let fin
    for await (const c of stream) { if (c.type === 'text-delta') out += c.text; else if (c.type === 'finish') fin = c.reason }
    if (fin?.kind && fin.kind !== 'stop') throw new Error(fin.failure?.message ?? `el revisor terminó con ${fin.kind}`)
    const v = leerVeredicto(out)
    if (!v) throw new Error('el revisor no respondió en el formato esperado')
    return v
  }

  const listar = (ps) => ps.map((p, i) => `${i + 1}. [${p.gravedad.toUpperCase()}] ${p.archivo}${p.linea ? `:${p.linea}` : ''} — ${p.problema}${p.arreglo ? `\n   Arreglo sugerido: ${p.arreglo}` : ''}`).join('\n')

  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const s = estados.get(agent)
    if (!s || !s.antes.size) return
    let partes
    try { partes = await cambios(agent, signal) } catch { return }
    if (!partes.length) return
    const firma = partes.join('\n').length + ':' + partes.join('\n').slice(-200)
    if (firma === s.ultimaFirma) return // nada nuevo desde la última revisión
    const total = partes.reduce((n, d) => n + lineasCambiadas(d), 0)
    if (total < cfg.minLineas) return
    if (s.rondas >= cfg.rondas) return
    s.ultimaFirma = firma
    let v
    try { v = await revisar(agent, signal, partes, s.pedido.join('\n\n'), s.previos) } catch (e) {
      ctx.logger?.warn?.(`segunda-opinion: no se pudo revisar (${e?.message ?? e})`)
      return
    }
    if (signal?.aborted) return
    const minimo = ORDEN[cfg.gravedadMinima] ?? 2
    const graves = v.problemas.filter((p) => ORDEN[p.gravedad] >= minimo)
    if (!graves.length) { ctx.logger?.info?.(`segunda-opinion: aprobado (${total} líneas revisadas)`); return }
    s.rondas++
    s.previos = graves
    agent.steer(aviso([
      `[Segunda opinión] Un revisor independiente (${cfg.revisor.model}) revisó tus cambios antes de entregar y encontró ${graves.length} problema(s) importante(s):`,
      '',
      listar(graves),
      '',
      'Corrígelos ahora. Si estás SEGURO de que un punto es un error del revisor, no lo cambies y explícale al usuario en una línea por qué. Después resume al usuario qué cambió por esta revisión.',
      s.rondas >= cfg.rondas ? '(Es la última ronda de revisión para este pedido.)' : '',
    ].filter(Boolean).join('\n'), `Segunda opinión: ${graves.length} problema(s) a corregir`))
  })

  // Revisión a pedido: lo que cambió en este pedido o, si no hay, el diff de git sin confirmar.
  ctx.tools.register({
    name: 'segunda_opinion',
    description: 'Pide a un revisor independiente (otro modelo) que revise los cambios: los de este pedido o, si no hay, los cambios sin confirmar de git (git diff). Úsala cuando el usuario pida "revisa", "dame una segunda opinión" o antes de una entrega importante. Devuelve los problemas encontrados.',
    parameters: { type: 'object', properties: { enfoque: { type: 'string', description: 'Opcional: en qué fijarse (seguridad, rendimiento, un requisito)' } } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    timeoutMs: (DEFAULTS.timeoutSegundos + 30) * 1000,
    async execute(args, exec) {
      const s = estado(exec.agent)
      let partes = await cambios(exec.agent, exec.signal)
      if (!partes.length) {
        const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
        const diff = await new Promise((ok) => execFile('git', ['diff', 'HEAD', '--no-color', '-U3'], { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (e, out) => ok(e ? '' : out)))
        if (diff.trim()) partes = [diff]
      }
      if (!partes.length) return 'No hay cambios para revisar (ni en este pedido ni sin confirmar en git).'
      const pedido = [s.pedido.join('\n\n'), args?.enfoque ? `Enfoque pedido por el usuario: ${args.enfoque}` : ''].filter(Boolean).join('\n\n') || 'Revisión general de los cambios.'
      const v = await revisar(exec.agent, exec.signal, partes, pedido, [])
      if (!v.problemas.length) return `✅ El revisor (${cfg.revisor.model}) aprobó los cambios. ${v.resumen}`
      return `Revisor (${cfg.revisor.model}): ${v.veredicto === 'cambios' ? 'pide cambios' : 'aprueba con observaciones'}. ${v.resumen}\n\n${listar(v.problemas)}`
    },
  })
}
