import { apply, generar, probar, cronAWindows, validarCron, normalizarVariables, textoSeguro, resumenEjecuciones, leerEjecuciones } from '../plugins/dsh-automatizador/index.js'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

// utilidades
assert.deepEqual(cronAWindows('0 7 * * *'), { tipo: 'diario', horas: ['07:00'] })
assert.deepEqual(cronAWindows('30 6,14 * * 1-5'), { tipo: 'semanal', horas: ['06:30', '14:30'], dias: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] })
assert.deepEqual(cronAWindows('*/15 * * * *'), { tipo: 'cadaMinutos', minutos: 15 })
assert.equal(cronAWindows('0 7 1 * *'), null)
assert.match(validarCron('0 7 * *'), /5 campos/)
assert.equal(validarCron('0 7 * * 1-5'), null)
assert.deepEqual(normalizarVariables(['portal clave', { nombre: 'PORTAL_CLAVE' }, { nombre: '1' }]).map((v) => v.nombre), ['PORTAL_CLAVE'])
assert.ok(!/["*\/]{2}|"/.test(textoSeguro('dice "hola" */ fin')))

// webhook falso para avisos
const avisos = []
const srv = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { avisos.push(JSON.parse(b)); res.end('ok') }) })
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const webhook = `http://127.0.0.1:${srv.address().port}/hook`

for (const lenguaje of ['python', 'java']) {
  const cwd = await mkdtemp(path.join(tmpdir(), `auto-${lenguaje}-`))
  const r = await generar(cwd, { nombre: `Reporte Ventas ${lenguaje}`, lenguaje, descripcion: 'Envía el "reporte" */ diario', horario: '30 6 * * 1-5', variables: [{ nombre: 'PORTAL_CLAVE', descripcion: 'clave del portal' }] })
  const dir = path.join(cwd, r.carpeta)
  for (const f of ['.env.example', '.gitignore', 'Dockerfile', 'docker-compose.yml', 'fly.toml', 'ejecutar.cmd', 'programar_windows.ps1', 'README.md']) assert.ok(existsSync(path.join(dir, f)), `${lenguaje}: falta ${f}`)
  await assert.rejects(generar(cwd, { nombre: `Reporte Ventas ${lenguaje}`, lenguaje }), /ya existe/)
  const docker = await readFile(path.join(dir, 'Dockerfile'), 'utf8')
  assert.match(docker, /30 6 \* \* 1-5 cd \/app/); assert.match(docker, /TZ=America\/Bogota/)
  assert.match(await readFile(path.join(dir, 'programar_windows.ps1'), 'utf8'), /-Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 06:30/)
  const todo = (await Promise.all(r.archivos.map((f) => readFile(path.join(dir, f), 'utf8')))).join('\n')
  assert.ok(!todo.includes('{{'), `${lenguaje}: quedaron marcadores`)

  // 1) falta la variable requerida → error claro, sin aviso en modo prueba
  let p = await probar(cwd, { nombre: r.nombre })
  assert.equal(p.ok, false); assert.match(p.ejecucion.error, /PORTAL_CLAVE/)

  // 2) con .env: prueba no marca nada
  await writeFile(path.join(dir, '.env'), `PORTAL_CLAVE=super-secreta-123\nAVISO_WEBHOOK_URL=${webhook}\n`)
  p = await probar(cwd, { nombre: r.nombre })
  assert.ok(p.ok, `${lenguaje} prueba: ${p.consola}`); assert.equal(p.ejecucion.modo, 'prueba')
  assert.match(p.consola, /modo prueba: se procesaría/)
  assert.equal(p.ejecucion.resultado.procesados, 0)

  // 3) real procesa 2, la segunda vez 0 (no duplica), --forzar re-procesa
  p = await probar(cwd, { nombre: r.nombre, modo: 'real' }); assert.equal(p.ejecucion.resultado.procesados, 2)
  p = await probar(cwd, { nombre: r.nombre, modo: 'real' }); assert.equal(p.ejecucion.resultado.procesados, 0)
  p = await probar(cwd, { nombre: r.nombre, modo: 'real', forzar: true }); assert.equal(p.ejecucion.resultado.procesados, 2)

  // 4) error real: registra el paso que falló, oculta el secreto, avisa por webhook
  const archivoTarea = lenguaje === 'python' ? path.join(dir, 'tarea.py') : path.join(dir, 'src/main/java/automatizacion/Tarea.java')
  let t = await readFile(archivoTarea, 'utf8')
  t = lenguaje === 'python'
    ? t.replace('ctx.log.info("datos obtenidos"', 'raise RuntimeError("portal caído con " + ctx.config("PORTAL_CLAVE"))\n        ctx.log.info("datos obtenidos"')
    : t.replace('ctx.log().info("datos obtenidos"', 'if (true) throw new IllegalStateException("portal caído con " + ctx.config("PORTAL_CLAVE"));\n            ctx.log().info("datos obtenidos"')
  await writeFile(archivoTarea, t)
  const n = avisos.length
  p = await probar(cwd, { nombre: r.nombre, modo: 'real' })
  assert.equal(p.ok, false); assert.equal(p.codigoSalida, 1)
  assert.equal(resumenEjecuciones([p.ejecucion]).ejecuciones[0].pasoFallido, 'obtener datos')
  const logs = await readFile(path.join(dir, 'logs', 'ejecuciones.jsonl'), 'utf8')
  assert.ok(!logs.includes('super-secreta-123') && !p.consola.includes('super-secreta-123'), `${lenguaje}: se filtró el secreto`)
  assert.equal(avisos.length, n + 1, `${lenguaje}: no llegó el aviso`)
  assert.match(avisos.at(-1).text, /❌/); assert.ok(!JSON.stringify(avisos.at(-1)).includes('super-secreta-123'))

  // historial
  const res = resumenEjecuciones(await leerEjecuciones(dir, 20))
  assert.equal(res.reales, 4); assert.equal(res.exitoReales, '75%')
  console.log(`  ${lenguaje}: ok`)
}
srv.close()

// registro del plugin
const tools = {}; let seccion
apply({ tools: { register: (t) => (tools[t.name] = t) }, systemPrompt: { section: (s) => (seccion = s) }, workingDirectory: { ensure: async () => tmpdir() } }, {})
assert.deepEqual(Object.keys(tools).sort(), ['automatizacion_crear', 'automatizacion_ejecuciones', 'automatizacion_probar'])
assert.match(seccion.text, /prueba mode/)
console.log('automatizador: ok')
for (const t of Object.values(tools)) assert.ok(t.output?.schema && typeof t.output.render === 'function', `${t.name} sin output`)
{
  const cwd = await mkdtemp(path.join(tmpdir(), 'auto-tool-'))
  const ctx2 = { tools: { register: (t) => (tools[t.name] = t) }, systemPrompt: { section: () => {} }, workingDirectory: { ensure: async () => cwd } }
  apply(ctx2, {})
  const c = await tools.automatizacion_crear.execute({ nombre: 'demo', lenguaje: 'python', variables: [] }, {})
  assert.match(c, /tarea\.py/)
  const pr = await tools.automatizacion_probar.execute({ nombre: 'demo' }, {})
  assert.match(pr, /✅ Ejecución en modo prueba/); assert.match(pr, /✓ procesar/)
  assert.match(await tools.automatizacion_ejecuciones.execute({}, {}), /demo \(python\): última .* prueba · ok/)
  assert.match(await tools.automatizacion_ejecuciones.execute({ nombre: 'demo' }, {}), /1 ejecuciones \(0 reales/)
  console.log('herramientas: ok')
}
