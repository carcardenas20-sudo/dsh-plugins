// Motor de automatizaciones con roles y varios equipos: permisos por rol, correEn, turnos compartidos
// (una tarea programada corre en un solo equipo) y registro de corridas en la base. Electron y Supabase simulados.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const Module = require('node:module')
const turnos = new Set(), corridas = [], lanzados = []
const supabaseFalso = {
  createClient: () => ({
    from: (t) => ({
      insert: async (fila) => {
        if (t === 'automatizacion_turnos') { if (turnos.has(fila.clave)) return { error: { code: '23505', message: 'duplicate key value' } }; turnos.add(fila.clave); return {} }
        corridas.push(fila); return {}
      },
    }),
  }),
}
const electronFalso = {
  powerMonitor: { on() {} },
  utilityProcess: {
    fork() {
      const p = new EventEmitter()
      p.postMessage = (m) => {
        if (m.tipo === 'describir') setTimeout(() => p.emit('message', { tipo: 'descripcion', lista: m.archivos.map((archivo) => ({ archivo, ...metas[path.basename(archivo, '.js')] })) }), 5)
        if (m.tipo === 'ejecutar') { lanzados.push(m.datos.id); setTimeout(() => p.emit('message', { tipo: 'fin', ok: true, resultado: 'listo', ms: 3 }), 5) }
      }
      p.kill = () => {}
      setTimeout(() => p.emit('spawn'), 1)
      return p
    },
  },
}
const cargarOriginal = Module._load
Module._load = (r, ...a) => (r === 'electron' ? electronFalso : r === '@supabase/supabase-js' ? supabaseFalso : cargarOriginal(r, ...a))
const { crearMotor } = require('../plugins/dsh-escritorio/plantilla/motor/motor.cjs')

const metas = {
  'descargar-pagos': { nombre: 'Descargar pagos', cuando: { cada: '10s' } },
  'respaldo-local': { nombre: 'Respaldo local', cuando: { cada: '10s' }, unaVez: false },
  'cierre-caja': { nombre: 'Cierre de caja', cuando: { manual: true }, correEn: { sede: 'Norte' } },
  'reporte-gerencia': { nombre: 'Reporte gerencia', cuando: { manual: true } },
}
const dir = await mkdtemp(path.join(os.tmpdir(), 'motor-'))
await mkdir(path.join(dir, 'autos'))
for (const id of Object.keys(metas)) await writeFile(path.join(dir, 'autos', `${id}.js`), 'module.exports = {}')
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

function equipo(nombre) {
  const avisos = []
  const m = crearMotor({ carpetaAutomatizaciones: path.join(dir, 'autos'), carpetaDatos: path.join(dir, nombre), config: { supabase: { url: 'https://x.supabase.co', clave: 'publica' }, equipo: nombre }, avisar: (l) => avisos.push(l), notificar() {}, alEventoInterfaz() {} })
  return { m, avisos }
}
const sesion = { access_token: 't', refresh_token: 'r' }
const caja = equipo('CAJA-NORTE'), gerencia = equipo('GERENCIA')
await caja.m.cargar(); await gerencia.m.cargar()

// sin sesión: nada corre y todo dice por qué
assert.ok(caja.m.lista().every((a) => !a.permitida && /inicie sesión/.test(a.bloqueo)))
assert.throws(() => caja.m.ejecutar('reporte-gerencia'), /inicie sesión/)

// cajero de Norte: solo sus automatizaciones; el gerente, todas
caja.m.fijarSesion(sesion, { id: 'u1', rol: 'cajero', sede: 'Norte', automatizaciones: ['descargar-pagos', 'respaldo-local', 'cierre-caja'] })
gerencia.m.fijarSesion(sesion, { id: 'u2', rol: 'gerente', sede: null, automatizaciones: ['*'] })
assert.deepEqual(caja.m.lista().map((a) => a.id).sort(), ['cierre-caja', 'descargar-pagos', 'respaldo-local'], 'lo que su rol no permite ni se muestra')
assert.throws(() => caja.m.ejecutar('reporte-gerencia'), /no existe|no tiene permiso/)
assert.equal(gerencia.m.lista().length, 4)
// correEn: "cierre-caja" solo se activa donde la sede es Norte
assert.equal(caja.m.lista().find((a) => a.id === 'cierre-caja').correAqui, true)
assert.match(gerencia.m.lista().find((a) => a.id === 'cierre-caja').bloqueo, /sede sea norte/)

// manual: corre donde se pide
caja.m.ejecutar('cierre-caja'); await caja.m.esperarTodas(); await espera(30)
assert.deepEqual(lanzados, ['cierre-caja'])
assert.equal(corridas.at(-1).automatizacion, 'cierre-caja'); assert.equal(corridas.at(-1).equipo, 'CAJA-NORTE'); assert.equal(corridas.at(-1).ok, true)

// programadas en los 2 equipos: "descargar-pagos" corre una sola vez por turno; "respaldo-local" (unaVez: false) en ambos
lanzados.length = 0
await espera(10_600)
await caja.m.esperarTodas(); await gerencia.m.esperarTodas(); await espera(50)
const cuenta = (id) => lanzados.filter((x) => x === id).length
assert.equal(cuenta('descargar-pagos'), 1, `una sola vez entre los dos equipos (corrió ${cuenta('descargar-pagos')})`)
assert.equal(cuenta('respaldo-local'), 2, 'unaVez: false corre en cada equipo')
assert.ok([...turnos].some((t) => t.startsWith('descargar-pagos@')))

// al cerrar sesión se desarma todo
caja.m.fijarSesion(null, null); gerencia.m.fijarSesion(null, null)
lanzados.length = 0
await espera(10_400)
assert.equal(lanzados.length, 0, 'sin sesión no corre nada programado')
caja.m.detener(); gerencia.m.detener()
console.log('motor: ok (permisos por rol, correEn, turno único entre equipos, unaVez:false, corridas en la base, sin sesión no corre)')
process.exit(0)
