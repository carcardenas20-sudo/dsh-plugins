import { apply, diferencia, leerVeredicto, lineasCambiadas } from '../plugins/dsh-segunda-opinion/index.js'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

// diferencia
const d = diferencia('a.js', 'uno\ndos\ntres\ncuatro\ncinco', 'uno\ndos\nTRES\ncuatro\ncinco')
assert.match(d, /- {4}3 tres/); assert.match(d, /\+ {4}3 TRES/); assert.match(d, /\n {5}2 dos/); assert.equal(lineasCambiadas(d), 2)
assert.match(diferencia('n.js', null, 'a\nb'), /archivo nuevo[\s\S]*\+ {3}1 a/)
assert.equal(diferencia('x', 'igual', 'igual'), '')

// veredicto
assert.equal(leerVeredicto('nada'), null)
const v = leerVeredicto('```json\n{"veredicto":"cambios","resumen":"r","problemas":[{"gravedad":"alta","archivo":"a.js","linea":3,"problema":"divide por cero","arreglo":"validar"},{"gravedad":"rara","problema":"x"}]}\n```')
assert.equal(v.veredicto, 'cambios'); assert.equal(v.problemas.length, 2); assert.equal(v.problemas[1].gravedad, 'media')

// flujo completo con un revisor falso
const cwd = await mkdtemp(path.join(tmpdir(), 'so-'))
await writeFile(path.join(cwd, 'precio.js'), 'export function precio(costo, margen) {\n  return costo\n}\n')
const h = {}; const tools = {}; const llamadas = []; let respuesta
const llm = { stream: (o) => { llamadas.push(o); return (async function* () { yield { type: 'text-delta', text: respuesta }; yield { type: 'finish', reason: { kind: 'stop' } } })() } }
apply({ on: (e, f) => { h[e] = f }, tools: { register: (t) => { tools[t.name] = t } }, llm, workingDirectory: { ensure: async () => cwd }, logger: {} }, {})
const avisos = []
const agent = { session: { id: 's1' }, model: { current: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) }, steer: (m) => avisos.push(m) }
const sig = new AbortController().signal
const turnoUsuario = (t) => h['agent/pre-step']({ agent, signal: sig }, async () => ({ kind: 'enter', messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: t }] }] }))
const editar = async (contenido) => { await h['tools/pre-execute']({ agent, name: 'write', arguments: { file_path: 'precio.js' }, signal: sig }, async () => ({ kind: 'continue' })); await writeFile(path.join(cwd, 'precio.js'), contenido) }

await turnoUsuario('calcula el precio con margen sobre el precio de venta')
await editar('export function precio(costo, margen) {\n  // margen sobre el precio\n  const p = costo / (1 - margen / 100)\n  return Math.round(p)\n}\n')
respuesta = JSON.stringify({ veredicto: 'cambios', resumen: 'falla con margen 100', problemas: [{ gravedad: 'alta', archivo: 'precio.js', linea: 3, problema: 'Con margen 100 divide por cero', arreglo: 'validar margen < 100' }, { gravedad: 'baja', archivo: 'precio.js', problema: 'comentario', arreglo: '' }] })
await h['agent/turn-stopping']({ agent, signal: sig })
assert.equal(llamadas.length, 1); assert.equal(llamadas[0].model, 'deepseek-v4-pro'); assert.equal(llamadas[0].provider, 'deepseek-official')
const pedidoRevisor = llamadas[0].messages[0].content[0].text
assert.match(pedidoRevisor, /margen sobre el precio de venta/); assert.match(pedidoRevisor, /- {4}2 {3}return costo/); assert.match(pedidoRevisor, /\+ {4}3 {3}const p = costo/)
assert.equal(avisos.length, 1); assert.equal(avisos[0].source.form, 'notice'); assert.ok(Object.isFrozen(avisos[0]))
assert.match(avisos[0].content[0].text, /1 problema\(s\)[\s\S]*divide por cero/); assert.ok(!avisos[0].content[0].text.includes('comentario'), 'lo bajo no se devuelve')

// sin cambios nuevos: no vuelve a revisar
await h['agent/turn-stopping']({ agent, signal: sig }); assert.equal(llamadas.length, 1)
// el agente corrige: segunda ronda, el revisor aprueba => silencio
await editar('export function precio(costo, margen) {\n  if (margen >= 100) throw new Error("margen inválido")\n  const p = costo / (1 - margen / 100)\n  return Math.round(p)\n}\n')
respuesta = '{"veredicto":"aprobado","resumen":"ok","problemas":[]}'
await h['agent/turn-stopping']({ agent, signal: sig })
assert.equal(llamadas.length, 2); assert.match(llamadas[1].messages[0].content[0].text, /SEGUNDA REVISIÓN[\s\S]*divide por cero/); assert.equal(avisos.length, 1)

// cambios mínimos: no gasta revisor
await turnoUsuario('arregla una tilde')
await editar((await readFile(path.join(cwd, 'precio.js'), 'utf8')).replace('inválido', 'invalido'))
await h['agent/turn-stopping']({ agent, signal: sig }); assert.equal(llamadas.length, 2)

// tope de rondas
await turnoUsuario('cambia todo')
respuesta = JSON.stringify({ veredicto: 'cambios', problemas: [{ gravedad: 'media', archivo: 'precio.js', problema: 'p' }] })
for (let i = 0; i < 4; i++) { await editar(`export const v${i} = ${i}\n`.repeat(6)); await h['agent/turn-stopping']({ agent, signal: sig }) }
assert.equal(avisos.length, 3, 'máximo 2 rondas por pedido')

// revisor que falla: no bloquea ni avisa
await turnoUsuario('otra')
respuesta = 'lo siento'
await editar('x\n'.repeat(10)); await h['agent/turn-stopping']({ agent, signal: sig }); assert.equal(avisos.length, 3)

// herramienta a pedido sobre git diff
execFileSync('git', ['init', '-q'], { cwd }); execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=t', 'add', '.'], { cwd }); execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-qm', 'i'], { cwd })
await writeFile(path.join(cwd, 'precio.js'), 'export const cambiado = true\n')
const ag2 = { session: { id: 's2' }, model: agent.model, steer() {} }
respuesta = '{"veredicto":"aprobado","resumen":"todo bien","problemas":[]}'
assert.match(await tools.segunda_opinion.execute({ enfoque: 'seguridad' }, { agent: ag2, signal: sig }), /✅ El revisor .* aprobó/)
assert.match(llamadas.at(-1).messages[0].content[0].text, /Enfoque pedido por el usuario: seguridad[\s\S]*\+export const cambiado/)
console.log('segunda-opinion unit: OK')
