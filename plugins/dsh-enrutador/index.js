// dsh-enrutador — elige el modelo paso a paso según la dificultad y cuida el presupuesto.
//
// - Trabaja con el modelo económico (Flash) por defecto.
// - Pasa al modelo fuerte (V4 Pro) solo cuando hace falta: el pedido es de diseño
//   o depuración, los comandos/herramientas fallan seguido, o la Prueba de entrega
//   reporta fallos. Vuelve al económico cuando el problema se resuelve.
// - Lleva la cuenta en dólares por tarea y por día y respeta los topes.
//
// Sin dependencias. Precios por defecto: DeepSeek, noviembre 2026 (configurables).

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const name = 'enrutador'
export const inject = ['tools']

const SOURCE_KIND = 'enrutador'

const DEFAULTS = {
  economico: undefined, // { provider, model }. Por defecto: el modelo que el usuario ya tenga elegido.
  fuerte: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
  erroresParaEscalar: 2,
  pasosFuertesMax: 4,
  palabrasDificiles: ['diseñ', 'arquitect', 'planea', 'refactor', 'depur', 'debug', 'bug', 'no funciona', 'falla', 'error', 'por qué', 'porque no', 'optimiz', 'seguridad', 'migra', 'rendimiento', 'race condition', 'concurrenc'],
  topeTareaUSD: 0.5,
  topeDiarioUSD: 3,
  // USD por millón de tokens, horario valle. En horario pico se multiplica por `multiplicadorPico`.
  precios: {
    'deepseek-flash': { entrada: 0.15, cache: 0.003, salida: 0.60 },
    'deepseek-v4-flash': { entrada: 0.15, cache: 0.003, salida: 0.60 },
    'deepseek-v4-pro': { entrada: 0.66, cache: 0.022, salida: 1.98 },
  },
  multiplicadorPico: 2,
  // Pico de DeepSeek: 01:00-04:00 y 06:00-10:00 UTC, lunes a viernes.
  horasPicoUTC: [[1, 4], [6, 10]],
}

// ---------------------------------------------------------------- utilidades

function deepFreeze(v) { if (v && typeof v === 'object') { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v) } return v }
function notice(text, summary) {
  return deepFreeze(structuredClone({
    role: 'user', content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND, form: 'notice', summary: summary.slice(0, 120) }, id: randomUUID(),
  }))
}
const usd = (n) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`
const hoy = () => new Date().toISOString().slice(0, 10)
const sameModel = (a, b) => !!a && !!b && a.provider === b.provider && a.model === b.model

export function esHoraPico(fecha, rangos) {
  const d = fecha.getUTCDay()
  if (d === 0 || d === 6) return false
  const h = fecha.getUTCHours()
  return rangos.some(([a, b]) => h >= a && h < b)
}

/** Costo en USD de una respuesta, según el modelo y su uso de tokens. */
export function costo(usage, model, cfg, fecha = new Date()) {
  const p = cfg.precios[model]
  if (!p || !usage) return { usd: 0, conocido: false }
  const cache = usage.cacheReadTokens ?? 0
  const out = usage.outputTokens ?? 0
  const inp = usage.inputTokens ?? 0
  // Algunos adaptadores incluyen la caché dentro de inputTokens y otros no.
  const incluyeCache = !(usage.totalTokens !== undefined && usage.totalTokens >= inp + out + cache && cache > 0)
  const sinCache = incluyeCache ? Math.max(0, inp - cache) : inp
  const mult = esHoraPico(fecha, cfg.horasPicoUTC) ? cfg.multiplicadorPico : 1
  return { usd: ((sinCache * p.entrada + cache * p.cache + out * p.salida) / 1e6) * mult, conocido: true }
}

export function textoDificil(texto, palabras) {
  const t = (texto ?? '').toLowerCase()
  return palabras.find((p) => t.includes(p.toLowerCase()))
}

function textoDe(message) {
  return (message?.content ?? []).map((b) => (b.type === 'text' ? b.text : '')).join(' ')
}

/** ¿El resultado de una herramienta es un fallo? */
export function esFallo(result) {
  if (!result) return false
  if (result.isError) return true
  const v = result.value
  if (v && typeof v === 'object' && typeof v.exitCode === 'number' && v.exitCode !== 0) return true
  return false
}

// ---------------------------------------------------------------- plugin

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}), precios: { ...DEFAULTS.precios, ...(rawConfig?.precios ?? {}) } }
  const archivoGasto = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'enrutador-gasto.json')
  const agentes = new WeakMap()
  const porSesion = new WeakMap() // session -> agent
  let diario = { fecha: hoy(), usd: 0 }
  let diarioCargado = false

  async function cargarDiario() {
    if (diarioCargado) return
    try { const d = JSON.parse(await readFile(archivoGasto, 'utf8')); if (d.fecha === hoy()) diario = d } catch { /* primer uso */ }
    diarioCargado = true
  }
  let guardando = Promise.resolve()
  function guardarDiario() {
    guardando = guardando.then(async () => {
      await mkdir(dirname(archivoGasto), { recursive: true })
      const tmp = `${archivoGasto}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(diario), 'utf8')
      await rename(tmp, archivoGasto)
    }).catch((e) => ctx.logger?.warn?.(`enrutador: no pude guardar el gasto: ${e?.message ?? e}`))
  }

  function st(agent) {
    let s = agentes.get(agent)
    if (!s) {
      s = { modo: 'economico', economico: undefined, motivo: 'inicio', erroresSeguidos: 0, pasosFuertes: 0,
        tarea: { usd: 0, pasos: 0, pasosFuertes: 0, avisoTope: false }, avisoDiario: undefined, ultimoCambio: undefined }
      agentes.set(agent, s)
      if (agent.session) porSesion.set(agent.session, agent)
    }
    return s
  }

  function modeloEconomico(agent, s) {
    if (cfg.economico?.provider && cfg.economico?.model) return cfg.economico
    if (!s.economico) {
      const cur = agent.model?.current?.()
      // Si el usuario ya está en el fuerte, el económico por defecto es Flash.
      s.economico = cur && !sameModel(cur, cfg.fuerte) ? { provider: cur.provider, model: cur.model }
        : { provider: cfg.fuerte.provider, model: 'deepseek-flash' }
    }
    return s.economico
  }

  function topeDiarioAlcanzado() { return cfg.topeDiarioUSD > 0 && diario.fecha === hoy() && diario.usd >= cfg.topeDiarioUSD }

  /** Cambia el modelo de los próximos pasos, solo si cambia algo. */
  function cambiar(agent, modo, motivo) {
    const s = st(agent)
    if (modo === 'fuerte' && topeDiarioAlcanzado()) modo = 'economico'
    const destino = modo === 'fuerte' ? cfg.fuerte : modeloEconomico(agent, s)
    const actual = agent.model?.current?.()
    s.modo = modo
    s.motivo = motivo
    if (modo === 'fuerte') s.pasosFuertes = 0
    if (sameModel(actual, destino)) return false
    try {
      agent.model.select({ provider: destino.provider, model: destino.model, ...(destino.reasoningEffort ? { reasoningEffort: destino.reasoningEffort } : {}) })
      s.ultimoCambio = { a: destino.model, motivo, fecha: new Date().toISOString() }
      ctx.logger?.info?.(`enrutador: ${destino.model} (${motivo})`)
      return true
    } catch (e) {
      ctx.logger?.warn?.(`enrutador: no pude cambiar a ${destino.model}: ${e?.message ?? e}`)
      return false
    }
  }

  // ------------------------------------------------ inicio de cada tarea

  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    try {
      const s = st(agent)
      const kind = message?.source?.kind
      if (kind === 'user') {
        s.tarea = { usd: 0, pasos: 0, pasosFuertes: 0, avisoTope: false }
        s.erroresSeguidos = 0
        const palabra = textoDificil(textoDe(message), cfg.palabrasDificiles)
        if (palabra) cambiar(agent, 'fuerte', `el pedido parece difícil ("${palabra}")`)
        else cambiar(agent, 'economico', 'pedido nuevo de rutina')
      } else if (kind === 'prueba-entrega' && /❌/.test(message.source?.summary ?? '')) {
        cambiar(agent, 'fuerte', 'la Prueba de entrega encontró fallos')
      }
    } catch (e) { ctx.logger?.warn?.(`enrutador: ${e?.message ?? e}`) }
  })

  // ------------------------------------------------ fallos y éxitos de herramientas

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    try {
      if (exec.agent && !exec.name.startsWith('enrutador_')) {
        const s = st(exec.agent)
        if (esFallo(result)) {
          s.erroresSeguidos += 1
          if (s.modo === 'economico' && s.erroresSeguidos >= cfg.erroresParaEscalar) {
            cambiar(exec.agent, 'fuerte', `${s.erroresSeguidos} fallos seguidos (${exec.name})`)
          }
        } else if (/^(bash|pwsh|powershell|shell|entrega_verificar)$/.test(exec.name)) {
          s.erroresSeguidos = 0
        }
      }
    } catch (e) { ctx.logger?.warn?.(`enrutador: ${e?.message ?? e}`) }
    return downstream
  })

  // ------------------------------------------------ costo de cada respuesta

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'assistant/message') return
    const agent = porSesion.get(session)
    const model = event.data?.message?.source?.model
    const c = costo(event.data?.usage, model, cfg, new Date(event.time ?? Date.now()))
    void (async () => {
      await cargarDiario()
      if (diario.fecha !== hoy()) diario = { fecha: hoy(), usd: 0 }
      diario.usd += c.usd
      guardarDiario()
      if (!agent) return
      const s = st(agent)
      s.tarea.usd += c.usd
      s.tarea.pasos += 1
      if (model === cfg.fuerte.model) { s.tarea.pasosFuertes += 1; s.pasosFuertes += 1 }

      // Volver al económico cuando el fuerte ya hizo su parte.
      if (s.modo === 'fuerte' && s.pasosFuertes >= cfg.pasosFuertesMax && s.erroresSeguidos === 0) {
        cambiar(agent, 'economico', `el modelo fuerte ya trabajó ${s.pasosFuertes} pasos sin nuevos fallos`)
      }
      // Topes.
      if (cfg.topeTareaUSD > 0 && s.tarea.usd >= cfg.topeTareaUSD && !s.tarea.avisoTope) {
        s.tarea.avisoTope = true
        cambiar(agent, 'economico', 'tope de la tarea alcanzado')
        try {
          agent.steer(notice(
            `[Enrutador] Esta tarea ya gastó ${usd(s.tarea.usd)}, el tope configurado es ${usd(cfg.topeTareaUSD)}. Termina solo lo indispensable, evita exploraciones nuevas y explícale al usuario qué falta y cuánto llevas gastado.`,
            `Tope de tarea: ${usd(s.tarea.usd)}`))
        } catch { /* turno ya cerrado */ }
      }
      if (topeDiarioAlcanzado() && s.avisoDiario !== diario.fecha) {
        s.avisoDiario = diario.fecha
        cambiar(agent, 'economico', 'tope diario alcanzado')
      }
    })().catch((e) => ctx.logger?.warn?.(`enrutador: ${e?.message ?? e}`))
  })

  // ------------------------------------------------ fin de tarea

  ctx.on('agent/turn-stopping', ({ agent }) => {
    const s = agentes.get(agent)
    if (s && s.modo === 'fuerte') cambiar(agent, 'economico', 'tarea terminada')
  })

  // ------------------------------------------------ consulta

  ctx.tools.register({
    name: 'enrutador_estado',
    description: 'Muestra qué modelo está usando el enrutador y por qué, cuánto lleva gastado la tarea actual y el día, y los topes. Úsala cuando el usuario pregunte por costos o por el modelo.',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(_args, exec) {
      await cargarDiario()
      const s = exec.agent ? st(exec.agent) : undefined
      const actual = exec.agent?.model?.current?.()
      const pico = esHoraPico(new Date(), cfg.horasPicoUTC)
      return [
        `Modelo actual: ${actual?.model ?? 'desconocido'} (${s?.modo ?? '—'}: ${s?.motivo ?? '—'})`,
        `Económico: ${s ? modeloEconomico(exec.agent, s).model : '—'} · Fuerte: ${cfg.fuerte.model}`,
        `Esta tarea: ${usd(s?.tarea.usd ?? 0)} en ${s?.tarea.pasos ?? 0} pasos (${s?.tarea.pasosFuertes ?? 0} con el fuerte). Tope: ${cfg.topeTareaUSD > 0 ? usd(cfg.topeTareaUSD) : 'sin tope'}`,
        `Hoy: ${usd(diario.fecha === hoy() ? diario.usd : 0)}. Tope diario: ${cfg.topeDiarioUSD > 0 ? usd(cfg.topeDiarioUSD) : 'sin tope'}`,
        `Horario: ${pico ? 'PICO (precios ×' + cfg.multiplicadorPico + ')' : 'valle'}`,
        'Los montos son estimados con la tabla de precios del plugin; el cobro real está en platform.deepseek.com.',
      ].join('\n')
    },
  })
}
