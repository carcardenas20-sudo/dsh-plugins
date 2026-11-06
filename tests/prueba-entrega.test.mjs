import { apply, _internals } from '../plugins/dsh-prueba-entrega/index.js'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'

function harness(config, approvalOutcome = 'allowed-once') {
  const ws = mkdtempSync(join(tmpdir(), 'ws-'))
  const tools = {}, handlers = {}, guards = [], sections = []
  const shell = { sandboxMode: undefined,
    resolve: (r) => r,
    execute: async (spec) => ({ result: () => new Promise((res) => {
      const p = spawn('bash', ['-c', spec.command], { cwd: spec.workdir })
      let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d)
      p.on('close', (code) => res({ exitCode: code, timedOut: false, aborted: false, stdout: { text: out }, stderr: { text: err } }))
    }) }) }
  const approvals = []
  const ctx = {
    tools: { register: (d) => { tools[d.name] = d }, guard: (g) => guards.push(g) },
    workingDirectory: { ensure: async () => ws },
    systemPrompt: { section: (s) => sections.push(s) },
    on: (ev, fn) => { handlers[ev] = fn },
    get: (n) => n === 'shell' ? shell : n === 'approval' ? { request: async (r) => { approvals.push(r); return approvalOutcome } } : undefined,
    logger: { warn: (m) => console.log('WARN', m) },
  }
  apply(ctx, config)
  const steers = [], selects = []
  let current = { provider: 'deepseek', model: 'deepseek-flash' }
  const agent = { session: {}, steer: (m) => steers.push(m),
    model: { current: () => current, select: (s) => { selects.push(s); current = s } } }
  const exec = (name, args = {}) => tools[name].execute(args, { agent, signal: new AbortController().signal, callId: 'call1' })
  const mutate = () => handlers['tools/post-execute']({ name: 'write', agent }, {}, async () => ({ kind: 'continue' }))
  const stop = () => handlers['agent/turn-stopping']({ agent, turn: 1, signal: new AbortController().signal })
  return { ws, tools, handlers, guards, sections, steers, selects, approvals, agent, exec, mutate, stop, cur: () => current }
}

const criterios = [
  { descripcion: 'El saludo queda guardado', verificacion: { tipo: 'archivo', ruta: 'ok.txt', contiene: 'hola' } },
  { descripcion: 'El script de prueba pasa', verificacion: { tipo: 'comando', comando: 'grep -q hola ok.txt && echo PRUEBA-OK', espera_texto: 'PRUEBA-OK' } },
]

// 1. ciclo completo con escalado
{
  const h = harness({ modeloEscalado: { provider: 'deepseek', model: 'deepseek-v4-pro' } })
  assert.deepEqual(Object.keys(h.tools).sort(), ['entrega_definir', 'entrega_estado', 'entrega_verificar'])
  assert.equal(h.sections.length, 1)
  const r = await h.exec('entrega_definir', { tarea: 'Guardar saludo', criterios })
  assert.match(r, /Contrato activo.*aprobado por el usuario/)
  assert.match(h.approvals[0].reason, /El saludo queda guardado/)
  assert.ok(existsSync(join(h.ws, '.entrega/contrato-activo.json')))
  // guard bloquea completar meta
  assert.match(h.guards[0]({ name: 'update_goal', arguments: { action: 'complete' }, agent: h.agent }), /contrato activo/)
  assert.equal(h.guards[0]({ name: 'update_goal', arguments: { action: 'pause' }, agent: h.agent }), undefined)
  // intento 1: falla
  await h.mutate(); await h.stop()
  assert.equal(h.steers.length, 1); assert.match(h.steers[0].content[0].text, /intento 1 de 3/)
  assert.equal(h.steers[0].source.kind, 'prueba-entrega'); assert.ok(Object.isFrozen(h.steers[0]))
  assert.equal(h.selects.length, 0)
  // intento 2: falla y escala
  await h.mutate(); await h.stop()
  assert.match(h.steers[1].content[0].text, /intento 2 de 3/); assert.match(h.steers[1].content[0].text, /modelo más fuerte/)
  assert.equal(h.cur().model, 'deepseek-v4-pro')
  // sin cambios no vuelve a verificar en loop... (sí reintenta porque última verificación roja, sin dirty -> avisado false) 
  // arreglar
  writeFileSync(join(h.ws, 'ok.txt'), 'hola mundo'); await h.mutate(); await h.stop()
  assert.match(h.steers[2].content[0].text, /✅ todo pasa \(2 verificaciones\)/)
  assert.equal(h.cur().model, 'deepseek-flash', 'restaura modelo')
  const lib = JSON.parse(readFileSync(join(h.ws, '.entrega/criterios.json'), 'utf8'))
  assert.equal(lib.length, 2)
  assert.equal(JSON.parse(readFileSync(join(h.ws, '.entrega/contrato-activo.json'), 'utf8')).estado, 'ninguno')
  const recibos = readdirSync(join(h.ws, '.entrega/recibos'))
  assert.equal(recibos.length, 3)
  const ultimo = readFileSync(join(h.ws, '.entrega/recibos', recibos.sort().at(-1)), 'utf8')
  assert.match(ultimo, /TODO PASA/)
  // sin contrato: cerrar no hace nada
  await h.stop(); assert.equal(h.steers.length, 3)
  // guard libre
  assert.equal(h.guards[0]({ name: 'update_goal', arguments: { action: 'complete' }, agent: h.agent }), undefined)
  // regresión: rompe el archivo y nueva tarea -> la regresión aparece
  writeFileSync(join(h.ws, 'ok.txt'), 'adios')
  await h.exec('entrega_definir', { tarea: 'Otra cosa', criterios: [{ descripcion: 'existe readme', verificacion: { tipo: 'comando', comando: 'true' } }] })
  const v = await h.exec('entrega_verificar')
  assert.match(v, /Fallan 2 de 3/); assert.match(v, /\[regresión\] El saludo/)
  console.log('1 ciclo completo + escalado + regresión: OK')
}

// 2. bloqueo tras max intentos y desbloqueo con mensaje del usuario
{
  const h = harness({ maxIntentos: 2 })
  await h.exec('entrega_definir', { tarea: 'Imposible', criterios: [{ descripcion: 'falla', verificacion: { tipo: 'comando', comando: 'exit 1' } }] })
  await h.mutate(); await h.stop(); await h.mutate(); await h.stop(); await h.mutate(); await h.stop()
  assert.match(h.steers.at(-1).content[0].text, /Después de 2 intentos/)
  const n = h.steers.length; await h.mutate(); await h.stop(); assert.equal(h.steers.length, n, 'no insiste estando bloqueado')
  await h.handlers['agent/pre-step']({ agent: h.agent, messages: [{ source: { kind: 'user' } }] }, async () => 'ok')
  await h.mutate(); await h.stop(); assert.match(h.steers.at(-1).content[0].text, /intento 1 de 2/)
  console.log('2 bloqueo y desbloqueo: OK')
}

// 3. rechazo, validación, rutas
{
  const h = harness({}, 'rejected')
  assert.match(await h.exec('entrega_definir', { tarea: 'x', criterios }), /RECHAZÓ/)
  assert.match(await h.exec('entrega_estado'), /Sin contrato activo/)
  assert.throws(() => _internals.validarCriterios([]), /al menos un criterio/)
  assert.throws(() => _internals.validarCriterios([{ descripcion: 'a', verificacion: { tipo: 'magia' } }]), /comando" o "archivo/)
  assert.throws(() => _internals.insideWorkspace('/a/b', '../../etc/passwd'), /fuera del proyecto/)
  const h2 = harness({}, 'unavailable')
  assert.match(await h2.exec('entrega_definir', { tarea: 'x', criterios }), /sin confirmación/)
  await h2.exec('entrega_definir', { tarea: 'y', criterios: [{ descripcion: 'p', verificacion: { tipo: 'archivo', ruta: '../fuera.txt' } }] })
  assert.match(await h2.exec('entrega_verificar'), /fuera del proyecto/)
  // sin cambios en el turno no verifica
  const h3 = harness({})
  await h3.exec('entrega_definir', { tarea: 'z', criterios: [{ descripcion: 'p', verificacion: { tipo: 'comando', comando: 'true' } }] })
  const r = await h3.exec('entrega_verificar'); assert.match(r, /Todo pasa/); await h3.stop(); assert.equal(h3.steers.length, 0)
  console.log('3 rechazo, validación, rutas, sin cambios: OK')
}
