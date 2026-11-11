// dsh-ojos — le da "ojos" a los modelos que no ven imágenes (por ejemplo, DeepSeek-V4-Pro).
//
// Justo antes de cada paso del agente, si tu mensaje trae imágenes y el modelo
// elegido no las ve, el plugin se las muestra a un modelo con visión
// (DeepSeek-V4.1-Flash por defecto) y las cambia por una descripción detallada:
// texto transcrito tal cual, errores, interfaz, tablas y números.
// Si el modelo elegido sí ve imágenes, no hace nada.

export const name = 'ojos'
export const inject = ['llm']

const DEFAULTS = {
  vision: { model: 'deepseek-flash' }, // provider: por defecto el mismo del modelo elegido
  modelosConVision: [], // ids extra que sí ven imágenes aunque dsh no lo declare
  // ids que NO ven imágenes aunque estén marcados con "Image" en Settings → Models
  // (hay que marcarlos para que la interfaz de dsh deje adjuntar imágenes).
  modelosSinVision: ['deepseek-v4-pro'],
  siempre: false, // true = describir aunque el modelo elegido vea imágenes
  maxImagenes: 8,
  timeoutSegundos: 120,
}

const INSTRUCCION = [
  'Eres los ojos de otro modelo de IA que NO puede ver esta imagen. Ese modelo va a programar o responder basándose solo en lo que escribas.',
  'Describe la imagen de forma completa y fiel:',
  '1. Qué es (captura de pantalla, foto, diagrama, documento, diseño, tabla...).',
  '2. TODO el texto visible, transcrito exactamente, respetando mayúsculas, números, rutas y mensajes de error. Usa bloques de código para código, terminal o errores.',
  '3. Si es una interfaz: estructura y disposición, componentes, colores, estados (deshabilitado, seleccionado, con error) y lo que parezca roto o fuera de lugar.',
  '4. Si hay tablas o datos: reprodúcelos como tabla Markdown con todas las filas y columnas legibles.',
  '5. Si es un diagrama: cajas, conexiones y flechas.',
  'No inventes lo que no se lee; marca con [ilegible] lo dudoso. No des soluciones ni opiniones: solo describe. Escribe en el idioma del texto del usuario.',
].join('\n')

const hasImage = (m) => Array.isArray(m?.content) && m.content.some((b) => b?.type === 'image')
const textOf = (m) => (m?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim()

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v) }
  return v
}

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}), vision: { ...DEFAULTS.vision, ...(rawConfig?.vision ?? {}) } }
  const modelosVen = new Map() // "provider/model" -> boolean
  const cache = new Map() // "<mensaje>#<bloque>" -> texto descrito (reintentos del mismo paso)

  async function veImagenes(sel, signal) {
    if (!sel?.model) return false
    if (cfg.modelosConVision.includes(sel.model)) return true
    if (cfg.modelosSinVision.includes(sel.model)) return false
    const key = `${sel.provider}/${sel.model}`
    if (!modelosVen.has(key)) {
      let ve = false
      try {
        const info = await ctx.llm.resolveModelInfo(sel.provider, sel.model, signal)
        ve = Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
      } catch { ve = false }
      modelosVen.set(key, ve)
    }
    return modelosVen.get(key)
  }

  async function describir(imagen, contexto, visionSel, sessionId, signal) {
    const timeout = AbortSignal.timeout(cfg.timeoutSegundos * 1000)
    const fused = signal ? AbortSignal.any([signal, timeout]) : timeout
    const pedido = contexto ? `Mensaje del usuario que acompaña la imagen (solo como contexto):\n"""${contexto.slice(0, 2000)}"""` : 'El usuario no escribió texto con la imagen.'
    const stream = ctx.llm.stream({
      provider: visionSel.provider,
      model: visionSel.model,
      system: INSTRUCCION,
      ...(sessionId ? { sessionId } : {}),
      messages: [deepFreeze({
        role: 'user',
        content: [{ type: 'text', text: pedido }, imagen],
        source: { kind: 'user' },
        id: globalThis.crypto.randomUUID(),
      })],
      signal: fused,
    })
    let texto = ''
    let fin
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') texto += chunk.text
      else if (chunk.type === 'finish') fin = chunk.reason
    }
    if (fin?.kind === 'error') throw new Error(fin.failure?.message ?? 'error del modelo de visión')
    if (fin?.kind === 'aborted') throw new Error(timeout.aborted ? `tardó más de ${cfg.timeoutSegundos}s` : 'cancelado')
    if (!texto.trim()) throw new Error('el modelo de visión no devolvió texto')
    return texto.trim()
  }

  async function traducir(m, sel, visionSel, payload) {
    const contexto = textOf(m)
    const sessionId = payload.agent?.session?.id
    let n = 0
    const content = []
    for (let i = 0; i < m.content.length; i++) {
      const b = m.content[i]
      if (b?.type !== 'image') { content.push(b); continue }
      n += 1
      const key = `${m.id ?? ''}#${i}`
      let texto = cache.get(key)
      if (texto === undefined) {
        if (n > cfg.maxImagenes) {
          texto = `[Imagen ${n} omitida: el mensaje trae más de ${cfg.maxImagenes} imágenes y el modelo actual (${sel.model}) no ve imágenes.]`
        } else {
          try {
            const d = await describir(b, contexto, visionSel, sessionId, payload.signal)
            texto = `[Imagen ${n}: ${sel.model} no ve imágenes; ${visionSel.model} la describió así]\n${d}\n[Fin de la imagen ${n}]`
          } catch (e) {
            if (payload.signal?.aborted) throw e
            texto = `[Imagen ${n}: no se pudo describir (${e?.message ?? e}). Dile al usuario que la imagen no llegó y que puede cambiar a ${visionSel.model}, que sí ve imágenes.]`
            ctx.logger?.warn?.(`ojos: ${e?.message ?? e}`)
          }
        }
        cache.set(key, texto)
        if (cache.size > 200) cache.delete(cache.keys().next().value)
      }
      content.push({ type: 'text', text: texto })
    }
    return deepFreeze({ ...m, content })
  }

  // Red de seguridad: imágenes que ya estaban en el historial (por ejemplo, enviadas
  // con Flash antes de cambiar a Pro) no pasan por agent/pre-step. Envolvemos
  // llm.prepareCall para cambiarlas también justo antes de llamar al modelo.
  async function limpiarHistorial(messages, sel, signal, sessionId) {
    if (!Array.isArray(messages) || !messages.some(hasImage)) return messages
    if (!cfg.siempre && await veImagenes(sel, signal)) return messages
    const visionSel = { provider: cfg.vision.provider ?? sel.provider, model: cfg.vision.model }
    if (visionSel.model === sel.model && visionSel.provider === sel.provider) return messages
    const payload = { signal, agent: { session: { id: sessionId } } }
    const out = []
    for (const m of messages) out.push(hasImage(m) ? await traducir(m, sel, visionSel, payload) : m)
    return out
  }

  const llm = ctx.llm
  const original = llm?.prepareCall
  if (typeof original === 'function' && cfg.historial !== false) {
    const envuelto = async function (config, signal, ...rest) {
      const prepared = await original.call(this, config, signal, ...rest)
      if (!prepared || typeof prepared.stream !== 'function') return prepared
      const sel = { provider: config?.provider, model: config?.model }
      return Object.freeze({
        ...prepared,
        stream(options) {
          return (async function* () {
            let opts = options
            try {
              const msgs = await limpiarHistorial(options?.messages, sel, options?.signal, options?.sessionId)
              if (msgs !== options.messages) opts = { ...options, messages: msgs }
            } catch (e) {
              if (options?.signal?.aborted) throw e
              ctx.logger?.warn?.(`ojos (historial): ${e?.message ?? e}`)
            }
            yield* prepared.stream(opts)
          })()
        },
      })
    }
    try {
      llm.prepareCall = envuelto
      ctx.effect?.(() => () => { if (llm.prepareCall === envuelto) llm.prepareCall = original })
    } catch (e) {
      ctx.logger?.warn?.(`ojos: no pude envolver llm.prepareCall (${e?.message ?? e})`)
    }
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter' || !decision.messages.some(hasImage)) return decision
    const sel = payload.modelSelection ?? payload.agent?.model?.current?.()
    if (!sel) return decision
    if (!cfg.siempre && await veImagenes(sel, payload.signal)) return decision
    const visionSel = { provider: cfg.vision.provider ?? sel.provider, model: cfg.vision.model }
    if (visionSel.model === sel.model && visionSel.provider === sel.provider) return decision
    const messages = []
    for (const m of decision.messages) messages.push(hasImage(m) ? await traducir(m, sel, visionSel, payload) : m)
    ctx.logger?.info?.(`ojos: ${sel.model} no ve imágenes; descritas con ${visionSel.model}`)
    return { ...decision, messages }
  })
}

export const _internals = { INSTRUCCION, hasImage }
