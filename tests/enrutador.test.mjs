import { apply, costo, esHoraPico, esFallo, textoDificil } from '../plugins/dsh-enrutador/index.js'
import assert from 'node:assert/strict'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dh-'))
const h = {}; const ctx = { on: (e, f) => h[e] = f, tools: { register() {} }, logger: {} }
apply(ctx, { topeTareaUSD: 0.02, topeDiarioUSD: 0.05 })
const session = {}; let cur = { provider: 'deepseek-official', model: 'deepseek-flash' }; const steers = []
const agent = { session, steer: m => steers.push(m), model: { current: () => cur, select: s => cur = s } }
h['agent/inbox/inserted']({ agent, message: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hola, agrega un botón' }] } })
assert.equal(cur.model, 'deepseek-flash')
h['agent/inbox/inserted']({ agent, message: { source: { kind: 'prueba-entrega', summary: 'Entrega: 1 ❌ (intento 1)' }, content: [] } })
assert.equal(cur.model, 'deepseek-v4-pro')
await h['agent/turn-stopping']({ agent }); assert.equal(cur.model, 'deepseek-flash')
// gasto: cada paso pro ~ $0.0145 -> tope tarea 0.02 al 2º paso
const ev = () => ({ type: 'assistant/message', time: Date.parse('2026-11-06T22:00:00Z'), data: { message: { source: { model: 'deepseek-v4-pro' } }, usage: { inputTokens: 20000, cacheReadTokens: 0, outputTokens: 500 } } })
h['agent/inbox/inserted']({ agent, message: { source: { kind: 'user' }, content: [{ type: 'text', text: 'diseña la arquitectura' }] } })
assert.equal(cur.model, 'deepseek-v4-pro')
h['session/event'](session, ev()); await new Promise(r => setTimeout(r, 50))
assert.equal(steers.length, 0)
h['session/event'](session, ev()); await new Promise(r => setTimeout(r, 50))
assert.equal(steers.length, 1); assert.match(steers[0].content[0].text, /tope configurado es \$0.0200/); assert.equal(cur.model, 'deepseek-flash')
// tope diario: más gasto -> fuerte bloqueado
h['session/event'](session, ev()); h['session/event'](session, ev()); await new Promise(r => setTimeout(r, 50))
h['agent/inbox/inserted']({ agent, message: { source: { kind: 'user' }, content: [{ type: 'text', text: 'depura este bug' }] } })
assert.equal(cur.model, 'deepseek-flash', 'tope diario impide el fuerte')
// funciones puras
assert.equal(esHoraPico(new Date('2026-11-06T07:00:00Z'), [[1,4],[6,10]]), true)
assert.equal(esHoraPico(new Date('2026-11-07T07:00:00Z'), [[1,4],[6,10]]), false, 'sábado')
assert.ok(Math.abs(costo({ inputTokens: 1e6, outputTokens: 0 }, 'deepseek-flash', { precios: { 'deepseek-flash': { entrada: .15, cache: .003, salida: .6 } }, horasPicoUTC: [[6,10]], multiplicadorPico: 2 }, new Date('2026-11-06T07:00:00Z')).usd - 0.30) < 1e-9)
assert.equal(esFallo({ isError: false, value: { exitCode: 2 } }), true); assert.equal(esFallo({ isError: false, value: { exitCode: 0 } }), false)
assert.equal(textoDificil('No FUNCIONA el login', ['no funciona']), 'no funciona')
console.log('enrutador unit: OK')
