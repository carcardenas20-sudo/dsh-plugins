// Motor como programa aparte (lo usan las apps Tauri y JavaFX): procesos reales, protocolo de una línea JSON,
// datos privados pedidos a la app, notificaciones y modo prueba.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
const aqui = path.dirname(fileURLToPath(import.meta.url))
const app = await mkdtemp(path.join(os.tmpdir(), 'motor-servidor-'))
await cp(path.join(aqui, '../plugins/dsh-escritorio/plantilla/motor'), path.join(app, 'motor'), { recursive: true })
await mkdir(path.join(app, 'automatizaciones'))
await writeFile(path.join(app, 'escritorio.config.json'), JSON.stringify({ nombre: 'Prueba' }))
await writeFile(path.join(app, 'automatizaciones', 'saludo.js'), `module.exports = { nombre: 'Saludo', cuando: { manual: true }, secretos: ['clave'], avisarExito: true,
  async ejecutar({ registro, secreto, progreso }) { console.log('desde la automatización'); registro('empezó'); progreso(50, 'mitad'); const c = await secreto('clave'); return { largo: c ? c.length : 0 } } }`)
await writeFile(path.join(app, 'automatizaciones', 'rota.js'), `module.exports = { cuando: { cada: '1h' }, reintentos: 0, async ejecutar() { throw new Error('la página no cargó') } }`)

function abrir(env = {}) {
  const p = spawn(process.execPath, [path.join(app, 'motor', 'servidor.cjs'), app, path.join(app, '.datos')], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
  const eventos = []; const esperas = new Map(); let n = 0
  readline.createInterface({ input: p.stdout }).on('line', (l) => {
    const m = JSON.parse(l) // todo lo que sale por stdout tiene que ser JSON
    if (m.id && esperas.has(m.id)) { esperas.get(m.id)(m); esperas.delete(m.id) }
    else if (m.pedido) p.stdin.write(JSON.stringify({ respuesta: m.pedido, valor: m.metodo === 'secreto' && m.auto === 'saludo' && m.nombre === 'clave' ? 'demo123' : null }) + '\n')
    else eventos.push(m)
  })
  const llamar = (metodo, ...args) => new Promise((ok) => { const id = ++n; esperas.set(id, ok); p.stdin.write(JSON.stringify({ id, metodo, args }) + '\n') })
  const evento = (nombre, t = 15000) => new Promise((ok, mal) => { const fin = Date.now() + t; const v = () => { const e = eventos.find((x) => x.evento === nombre); if (e) ok(e); else if (Date.now() > fin) mal(new Error(`no llegó ${nombre}`)); else setTimeout(v, 50) }; v() })
  return { p, llamar, evento, eventos }
}

const m = abrir()
const listo = await m.evento('listo')
assert.deepEqual(listo.lista.map((a) => a.id).sort(), ['rota', 'saludo'])
assert.equal((await m.llamar('nada')).ok, false)
{ const r = await m.llamar('ejecutar', 'saludo'); assert.equal(r.ok, true, r.error) }
await m.evento('notificar')
const h = (await m.llamar('historial', 'saludo', 1)).valor[0]
assert.equal(h.ok, true, JSON.stringify(h)); assert.deepEqual(h.resultado, { largo: 7 }, 'el dato privado lo entregó la app')
assert.ok(h.registros.some((r) => r.includes('desde la automatización')), 'console.log de la automatización va al historial, no al canal')
await m.llamar('ejecutar', 'rota')
const err = await m.evento('error'); assert.match(err.error, /la página no cargó/)
await m.llamar('salir'); await new Promise((r) => m.p.on('exit', r))

// modo prueba: sin horarios, corre todo una vez, con secretos de prueba
const t = abrir({ DSH_ESCRITORIO_PRUEBA: '1', DSH_ESCRITORIO_SECRETOS: JSON.stringify({ 'saludo.clave': 'xy' }) })
await t.evento('listo')
const res = (await t.llamar('probar', [])).valor
assert.deepEqual(res.find((x) => x.id === 'saludo').resultado, { largo: 2 }); assert.equal(res.find((x) => x.id === 'rota').ok, false)
t.p.stdin.end(); await new Promise((r) => t.p.on('exit', r)) // al cerrarse la app, el motor se va
console.log('motor aparte (Tauri/Java): ok (protocolo JSON, procesos reales, datos privados por la app, errores, modo prueba)')
