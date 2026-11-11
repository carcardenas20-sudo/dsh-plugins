import { apply } from '../plugins/dsh-ojos/index.js'
import assert from 'node:assert/strict'

function harness(config, { visionText = 'Captura: error "TypeError: x is undefined" en línea 12', falla = false } = {}) {
  const h = {}; const llamadas = []
  const llm = {
    resolveModelInfo: async (p, m) => m === 'deepseek-flash' ? { id: m, inputModalities: ['text', 'image'] } : { id: m },
    stream: (opts) => { llamadas.push(opts); return (async function* () {
      if (falla) { yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } }; return }
      yield { type: 'text-delta', text: visionText }; yield { type: 'finish', reason: { kind: 'stop' } } })() },
  }
  apply({ on: (e, f) => h[e] = f, llm, logger: {} }, config)
  const run = (model, messages) => h['agent/pre-step'](
    { agent: { session: { id: 's1' } }, messages, turn: 1, step: 1, signal: new AbortController().signal, modelSelection: { provider: 'deepseek-official', model } },
    async () => ({ kind: 'enter', messages }))
  return { run, llamadas }
}
const img = { type: 'image', source: { kind: 'base64', data: 'AAA' } }
const msg = Object.freeze({ id: 'm1', role: 'user', source: { kind: 'user' }, content: Object.freeze([{ type: 'text', text: '¿qué es este error?' }, img]) })

{ // Pro: se describe y se reemplaza
  const t = harness()
  const d = await t.run('deepseek-v4-pro', [msg])
  assert.equal(t.llamadas.length, 1)
  assert.equal(t.llamadas[0].model, 'deepseek-flash'); assert.equal(t.llamadas[0].provider, 'deepseek-official')
  assert.deepEqual(t.llamadas[0].messages[0].content[1], img); assert.match(t.llamadas[0].messages[0].content[0].text, /qué es este error/)
  assert.equal(d.messages[0].content.some(b => b.type === 'image'), false)
  assert.match(d.messages[0].content[1].text, /deepseek-v4-pro no ve imágenes; deepseek-flash la describió/)
  assert.match(d.messages[0].content[1].text, /TypeError/)
  assert.equal(d.messages[0].id, 'm1'); assert.ok(Object.isFrozen(d.messages[0]))
  await t.run('deepseek-v4-pro', [msg]); assert.equal(t.llamadas.length, 1, 'reintento usa caché')
}
{ // Flash: no toca nada
  const t = harness(); const d = await t.run('deepseek-flash', [msg])
  assert.equal(t.llamadas.length, 0); assert.equal(d.messages[0], msg)
}
{ // sin imágenes: no toca
  const t = harness(); const plain = { id: 'p', content: [{ type: 'text', text: 'hola' }] }
  const d = await t.run('deepseek-v4-pro', [plain]); assert.equal(d.messages[0], plain); assert.equal(t.llamadas.length, 0)
}
{ // fallo del modelo de visión: texto de aviso, nunca la imagen cruda
  const t = harness({}, { falla: true }); const d = await t.run('deepseek-v4-pro', [msg])
  assert.match(d.messages[0].content[1].text, /no se pudo describir \(boom\)/)
}
{ // modelosConVision y maxImagenes
  const t = harness({ modelosConVision: ['deepseek-v4-pro'] }); await t.run('deepseek-v4-pro', [msg]); assert.equal(t.llamadas.length, 0)
  const t2 = harness({ maxImagenes: 1 })
  const dos = { id: 'm2', content: [img, img] }
  const d = await t2.run('deepseek-v4-pro', [dos]); assert.equal(t2.llamadas.length, 1); assert.match(d.messages[0].content[1].text, /omitida/)
}
{ // Pro marcado con imagen en Settings: igual se describe
  const h = {}; const ll = []
  apply({ on: (e, f) => h[e] = f, logger: {}, llm: { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }), stream: (o) => { ll.push(o); return (async function* () { yield { type: 'text-delta', text: 'x' }; yield { type: 'finish', reason: { kind: 'stop' } } })() } } }, {})
  await h['agent/pre-step']({ agent: {}, messages: [msg], modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }, async () => ({ kind: 'enter', messages: [msg] }))
  assert.equal(ll.length, 1)
}
{ // decisión reject pasa intacta
  const t = harness(); const h = {}
  const r = await (async () => { const hh = {}; apply({ on: (e, f) => hh[e] = f, llm: {}, logger: {} }, {}); return hh['agent/pre-step']({ messages: [msg], modelSelection: { provider: 'x', model: 'y' } }, async () => ({ kind: 'reject' })) })()
  assert.deepEqual(r, { kind: 'reject' })
}
{ // historial: imágenes viejas (enviadas con Flash) se cambian antes de llamar a Pro
  const h = {}; const ll = []; const enviados = []
  const llm = {
    resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
    stream: (o) => { ll.push(o); return (async function* () { yield { type: 'text-delta', text: 'desc' }; yield { type: 'finish', reason: { kind: 'stop' } } })() },
    prepareCall: async (config) => Object.freeze({ config, stream: (o) => { enviados.push(o); return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })() } }),
  }
  apply({ on: (e, f) => h[e] = f, llm, logger: {} }, {})
  const pro = await llm.prepareCall({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  for await (const _ of pro.stream({ provider: 'deepseek-official', model: 'deepseek-v4-pro', messages: [msg] })) {}
  assert.equal(ll.length, 1); assert.equal(enviados[0].messages[0].content.some(b => b.type === 'image'), false)
  const fl = await llm.prepareCall({ provider: 'deepseek-official', model: 'deepseek-flash' })
  for await (const _ of fl.stream({ provider: 'deepseek-official', model: 'deepseek-flash', messages: [msg] })) {}
  assert.equal(enviados[1].messages[0], msg, 'Flash recibe la imagen original')
}
console.log('ojos unit: OK')
