// Motor de automatizaciones como programa aparte, para las apps hechas con Tauri (Rust) y JavaFX (Java).
// La app lo arranca con el Node que viaja dentro del instalador:  node motor/servidor.cjs <carpetaApp> <carpetaDatos>
// y hablan por la entrada/salida estándar, un JSON por línea:
//   app → motor   { id, metodo, args }                 lista · ejecutar · activar · cancelar · historial · sesion · probar · salir
//   motor → app   { id, ok, valor | error }            respuesta
//                 { evento, ... }                      lista · notificar · interfaz · error · listo
//                 { pedido, metodo: 'secreto', auto, nombre }   la app responde { respuesta: pedido, valor }
// Lo que escriben las automatizaciones (console.log) queda en su historial, no en este canal.
'use strict'
const path = require('node:path')
const fs = require('node:fs')
const readline = require('node:readline')

const [carpetaApp = process.cwd(), carpetaDatos = path.join(process.cwd(), '.datos-motor')] = process.argv.slice(2)
const salida = process.stdout
const enviar = (m) => { try { salida.write(JSON.stringify(m) + '\n') } catch {} }
// nada más puede escribir en stdout: rompería el canal
console.log = console.info = console.warn = (...a) => process.stderr.write(a.map(String).join(' ') + '\n')

let config = {}
try { config = JSON.parse(fs.readFileSync(path.join(carpetaApp, 'escritorio.config.json'), 'utf8')) } catch (e) { process.stderr.write(`sin escritorio.config.json: ${e.message}\n`) }
if (process.env.DSH_EQUIPO) config.equipo = process.env.DSH_EQUIPO

const { crearMotor } = require('./motor.cjs')
let contador = 0
const esperando = new Map()
const pedir = (metodo, datos) => new Promise((ok) => {
  const pedido = ++contador
  const t = setTimeout(() => { esperando.delete(pedido); ok(null) }, 15e3)
  esperando.set(pedido, (v) => { clearTimeout(t); ok(v) })
  enviar({ pedido, metodo, ...datos })
})
const secretosPrueba = (() => { try { return JSON.parse(process.env.DSH_ESCRITORIO_SECRETOS || '{}') } catch { return {} } })()

fs.mkdirSync(carpetaDatos, { recursive: true })
const registrar = (m) => { try { fs.appendFileSync(path.join(carpetaDatos, 'motor.log'), `${new Date().toISOString()} ${m}\n`) } catch {} }
const prueba = !!process.env.DSH_ESCRITORIO_PRUEBA
const motor = crearMotor({
  carpetaAutomatizaciones: path.join(carpetaApp, 'automatizaciones'),
  carpetaDatos,
  config,
  armarDisparadores: !prueba,
  registrar,
  avisar: (lista) => enviar({ evento: 'lista', lista }),
  notificar: (titulo, cuerpo, id) => enviar({ evento: 'notificar', titulo: String(titulo ?? ''), cuerpo: String(cuerpo ?? ''), id }),
  alEventoInterfaz: (e) => enviar({ evento: 'interfaz', datos: e }),
  pedirSecreto: (auto, nombre) => (`${auto}.${nombre}` in secretosPrueba ? secretosPrueba[`${auto}.${nombre}`] : pedir('secreto', { auto, nombre })),
  alError: (id, error) => enviar({ evento: 'error', id, error: String(error) }),
})

// Igual que el modo prueba de la app Electron: cada automatización una vez, sin horarios.
async function probar(solo = []) {
  const lista = motor.lista()
  const res = []
  for (const a of lista) {
    if (a.error) { res.push({ id: a.id, ok: false, error: `no carga: ${a.error}` }); continue }
    if (solo.length ? !solo.includes(a.id) : a.enPrueba === false) { res.push({ id: a.id, omitida: true }); continue }
    motor.ejecutar(a.id, { prueba: true })
  }
  await motor.esperarTodas()
  for (const a of motor.lista()) {
    const h = motor.historial(a.id, 1)[0]
    if (!h || res.some((x) => x.id === a.id)) continue
    res.push({ id: a.id, nombre: a.nombre, cuando: a.cuando, ok: h.ok, ms: h.ms, resultado: h.resultado, error: h.error, registros: h.registros.slice(-25), capturas: h.capturas.map((c) => c.archivo) })
  }
  return res
}

const metodos = {
  lista: () => motor.lista(),
  ejecutar: (id, datos) => motor.ejecutar(String(id), datos),
  activar: (id, activa) => { motor.activar(String(id), !!activa); return true },
  cancelar: (id) => { motor.cancelar(String(id)); return true },
  historial: (id, n) => motor.historial(id ? String(id) : null, Math.min(Number(n) || 50, 500)),
  sesion: (s, info) => { motor.fijarSesion(s, info); return true },
  probar: (solo) => probar(Array.isArray(solo) ? solo.map(String) : []),
  // archivos que pidió la interfaz con abrirArchivo: solo los que están dentro de la carpeta de datos del motor
  ruta: (f) => { const r = path.resolve(carpetaDatos, String(f)); if (!r.startsWith(path.resolve(carpetaDatos))) throw new Error('fuera de la carpeta de datos'); return r },
  salir: () => { setTimeout(() => { motor.detener(); process.exit(0) }, 50); return true },
}

readline.createInterface({ input: process.stdin }).on('line', async (linea) => {
  let m
  try { m = JSON.parse(linea) } catch { return }
  if (m.respuesta) { const f = esperando.get(m.respuesta); esperando.delete(m.respuesta); f?.(m.valor ?? null); return }
  const fn = metodos[m.metodo]
  if (!fn) return enviar({ id: m.id, ok: false, error: `método desconocido: ${m.metodo}` })
  try { enviar({ id: m.id, ok: true, valor: (await fn(...(m.args || []))) ?? null }) } catch (e) { enviar({ id: m.id, ok: false, error: String(e?.message || e) }) }
}).on('close', () => { motor.detener(); process.exit(0) }) // la app se cerró

process.on('uncaughtException', (e) => { registrar(`error: ${e.stack || e}`); enviar({ evento: 'error', id: 'motor', error: String(e?.message || e) }) })
motor.cargar().then((lista) => enviar({ evento: 'listo', lista, equipo: motor.equipo })).catch((e) => enviar({ evento: 'error', id: 'motor', error: String(e?.message || e) }))
