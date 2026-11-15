import { apply, ameritaEncargo, senalaOmision, leerEncargo, leerVerificacion, textoEncargo, criteriosDe } from '../plugins/dsh-encargo/index.js'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// cuándo se amplía
assert.ok(ameritaEncargo('agrega el módulo de pagos al sistema'))
assert.ok(ameritaEncargo('necesito una pantalla para registrar exámenes'))
assert.ok(!ameritaEncargo('dale'))
assert.ok(!ameritaEncargo('sí, hazlo'))
assert.ok(!ameritaEncargo('¿cómo funciona el login actual?'))
assert.ok(!ameritaEncargo('agrega el botón de exportar, sin encargo'))
assert.ok(ameritaEncargo('revisa la tabla, con encargo'))
assert.ok(!ameritaEncargo('agrega el módulo de pagos', 'nunca'))
assert.ok(senalaOmision('te faltó validar el documento') && !senalaOmision('agrega validación'))
assert.equal(leerEncargo('no json'), null)
assert.equal(leerEncargo('{"tipo":"construir","pedido":"x","terminado":[]}'), null)
assert.equal(leerVerificacion('{"puntos":[{"n":1,"estado":"falta","nota":"a"},{"n":9,"estado":"falta"}]}', 3).length, 1)
assert.deepEqual(criteriosDe('# t\n\n- uno\n- dos\ntexto'), ['uno', 'dos'])

// flujo completo con modelos simulados
const cwd = await mkdtemp(path.join(tmpdir(), 'encargo-'))
await writeFile(path.join(cwd, 'AGENTS.md'), 'Regla: todo listado filtra por la sede del usuario.')
await mkdir(path.join(cwd, 'src'))
const llamadas = []
let respuestaVerificador
const ENCARGO = { tipo: 'construir', pedido: 'Pantalla de pagos del aprendiz', implicitos: ['Validar que el monto sea mayor que cero', 'Solo el coordinador registra pagos'], afectados: ['src/pagos.js'], terminado: ['Existe el formulario de pago', 'El monto se valida mayor que cero', 'El listado filtra por sede'], pregunta: null }
const hooks = {}, tools = {}, steers = []
let seccion
const agent = { steer: (m) => steers.push(m), model: { current: () => ({ provider: 'p' }) }, session: { id: 's1' } }
apply({
  tools: { register: (t) => (tools[t.name] = t) },
  systemPrompt: { section: (s) => (seccion = s) },
  workingDirectory: { ensure: async () => cwd },
  on: (n, f) => (hooks[n] = f),
  llm: { stream: (req) => (async function* () {
    llamadas.push(req)
    const esAnalista = req.system.includes('analista de requisitos senior')
    yield { type: 'text-delta', text: JSON.stringify(esAnalista ? ENCARGO : respuestaVerificador) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })() },
}, {})
assert.match(seccion.text, /\[Encargo\]/)
const usuario = (t) => ({ role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: t }] })
const entrar = (t) => hooks['agent/pre-step']({ agent }, async () => ({ kind: 'enter', messages: [usuario(t)] }))

// 1) pedido corto → encargo inyectado después del mensaje del usuario, con contexto del proyecto
let d = await entrar('hazme la pantalla de pagos')
assert.equal(d.messages.length, 2); assert.equal(d.messages[0].source.kind, 'user')
assert.equal(d.messages[1].source.form, 'recall')
assert.match(d.messages[1].content[0].text, /Está terminado cuando:\n1\. Existe el formulario de pago/)
assert.match(llamadas[0].messages[0].content[0].text, /todo listado filtra por la sede/)
assert.match(llamadas[0].messages[0].content[0].text, /ESTRUCTURA DEL PROYECTO:\nAGENTS\.md\nsrc\//)
assert.match(await readFile(path.join(cwd, '.dsh-encargo/ultimo.md'), 'utf8'), /Pantalla de pagos/)
assert.match(await tools.encargo_ver.execute({}, { agent }), /No se dijo, pero se necesita/)

// 2) sin cambios en archivos → no verifica
await hooks['agent/turn-stopping']({ agent }); assert.equal(steers.length, 0); assert.equal(llamadas.length, 1)

// 3) el agente escribe un archivo incompleto → el verificador lo devuelve
await hooks['tools/pre-execute']({ agent, name: 'write', arguments: { file_path: 'src/pagos.js' } }, async () => {})
await writeFile(path.join(cwd, 'src/pagos.js'), 'export function formularioPago(){ return "<form>" }\n')
respuestaVerificador = { puntos: [{ n: 1, estado: 'cumplido', nota: '' }, { n: 2, estado: 'falta', nota: 'No hay validación del monto' }, { n: 3, estado: 'no-aplica', nota: '' }] }
await hooks['agent/turn-stopping']({ agent })
assert.equal(steers.length, 1)
assert.match(steers[0].content[0].text, /2\. \[FALTA\] El monto se valida mayor que cero\n   → No hay validación del monto/)
assert.ok(!/Existe el formulario/.test(steers[0].content[0].text))
assert.match(llamadas[1].messages[0].content[0].text, /\+ export function formularioPago/)

// 4) mismo estado → no vuelve a verificar; corregido → pasa en silencio
await hooks['agent/turn-stopping']({ agent }); assert.equal(llamadas.length, 2)
await writeFile(path.join(cwd, 'src/pagos.js'), 'export function formularioPago(m){ if(!(m>0)) throw new Error("monto"); return "<form>" }\n')
respuestaVerificador = { puntos: [{ n: 1, estado: 'cumplido' }, { n: 2, estado: 'cumplido' }, { n: 3, estado: 'no-aplica' }] }
await hooks['agent/turn-stopping']({ agent }); assert.equal(steers.length, 1); assert.equal(llamadas.length, 3)

// 5) "dale" no genera encargo y conserva el vigente; una omisión pide guardar criterio
d = await entrar('dale'); assert.equal(d.messages.length, 1); assert.equal(llamadas.length, 3)
d = await entrar('te faltó el filtro por sede'); assert.match(d.messages.at(-1).content[0].text, /encargo_criterio/)

// 6) criterios: se guardan y entran al siguiente encargo
assert.match(await tools.encargo_criterio.execute({ accion: 'agregar', texto: 'Todo listado debe filtrar por la sede del usuario.' }, { agent }), /Criterio guardado/)
assert.match(await tools.encargo_criterio.execute({ accion: 'agregar', texto: 'todo listado debe filtrar por la sede del usuario.' }, { agent }), /ya estaba/)
await entrar('crea el reporte de asistencia')
assert.match(llamadas.at(-1).messages[0].content[0].text, /CRITERIOS APRENDIDOS[^]*Todo listado debe filtrar por la sede/)
assert.match(await tools.encargo_criterio.execute({ accion: 'quitar', numero: 1 }, { agent }), /Quitado/)

// 7) si el analista falla, el turno sigue normal
const hooks2 = {}
apply({ tools: { register() {} }, systemPrompt: { section() {} }, workingDirectory: { ensure: async () => cwd }, on: (n, f) => (hooks2[n] = f), llm: { stream: () => (async function* () { throw new Error('caído') })() } }, {})
d = await hooks2['agent/pre-step']({ agent }, async () => ({ kind: 'enter', messages: [usuario('crea el módulo de citas')] }))
assert.equal(d.messages.length, 1)
console.log('encargo: ok')
