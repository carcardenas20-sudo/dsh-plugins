// Lógica de datos-en-vivo.js (filtros, tiempo real, copia local, cola sin internet, conexión, sesión) con un Supabase simulado.
import assert from 'node:assert/strict'
const ls = new Map(); globalThis.localStorage = { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v) }
const evs = {}; const escritorioRecibio = []
globalThis.window = { addEventListener: (n, f) => ((evs[n] ||= []).push(f)), removeEventListener() {}, escritorio: { infoAhora: () => ({ version: '1.4.0', equipo: 'CAJA-1' }), automatizaciones: { sesion: (s, info) => escritorioRecibio.push({ s, info }) } } }
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
import { mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const aqui = path.dirname(fileURLToPath(import.meta.url))
const tmp = await mkdtemp(path.join(os.tmpdir(), 'datos-vivo-'))
await copyFile(path.join(aqui, 'fixtures/supabase-falso.mjs'), path.join(tmp, 'falso.mjs'))
await writeFile(path.join(tmp, 'dev.mjs'), (await readFile(path.join(aqui, '../plugins/dsh-escritorio/web/datos-en-vivo.js'), 'utf8')).replace("from '@supabase/supabase-js'", "from './falso.mjs'"))
const { estado } = await import(pathToFileURL(path.join(tmp, 'falso.mjs')).href); const { crearDatos } = await import(pathToFileURL(path.join(tmp, 'dev.mjs')).href)
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms))
const d = crearDatos({ url: 'https://abcd.supabase.co', clave: 'x' })
let vistas = []; const parar = d.enVivo('pagos', { filtro: { sede: 'Norte' }, orden: 'valor' }, (f, i) => vistas.push([f.map((x) => x.id), i.origen]))
await espera()
assert.deepEqual(vistas.at(-1), [[1], 'servidor'])
const canal = estado.canales.find((c) => c.nombre.startsWith('vivo:pagos')); assert.equal(canal.f.filter, 'sede=eq.Norte')
canal.cb({ eventType: 'INSERT', new: { id: 3, sede: 'Norte', valor: 1 } }); assert.deepEqual(vistas.at(-1), [[3, 1], 'tiempo-real'], 'ordena por valor')
canal.cb({ eventType: 'UPDATE', new: { id: 1, sede: 'Sur', valor: 10 } }); assert.deepEqual(vistas.at(-1)[0], [3], 'si ya no cumple el filtro, sale')
canal.cb({ eventType: 'DELETE', old: { id: 3 } }); assert.deepEqual(vistas.at(-1)[0], [])
// copia local: otra instancia sin red arranca con lo guardado
estado.red = false
const d2 = crearDatos({ url: 'https://abcd.supabase.co', clave: 'x' }); const v2 = []
d2.enVivo('pagos', { filtro: { sede: 'Norte' }, orden: 'valor' }, (f, i) => v2.push(i.origen)); await espera()
assert.deepEqual(v2.slice(0, 2), ['copia-local', 'copia-local'])
// cola sin internet
let pend = []; d.alCambiarPendientes((n) => pend.push(n))
assert.deepEqual(await d.guardar('pagos', { id: 9, valor: 7 }), { ok: true, enCola: true }); assert.equal(d.pendientes(), 1)
let con = []; d.alCambiarConexion((c) => con.push(c))
navigator.onLine = false; evs.offline.forEach((f) => f()); assert.deepEqual(con.at(-1), { estado: 'sin-conexion', pendientes: 1, rechazados: 0 })
estado.red = true; navigator.onLine = true; evs.online.forEach((f) => f()); await espera(50)
assert.equal(d.pendientes(), 0); assert.deepEqual(estado.escrituras.at(-1), ['upsert', 'pagos', { id: 9, valor: 7 }]); assert.deepEqual(con.at(-1), { estado: 'en-linea', pendientes: 0, rechazados: 0 })
// sesión
let ses = []; d.sesion.alCambiar((u, p) => ses.push([u?.email ?? null, p?.sede ?? null]))
assert.deepEqual(await d.sesion.entrar('a@b.co', 'mala'), { ok: false, error: 'Correo o clave incorrectos.' })
assert.deepEqual(await d.sesion.entrar('a@b.co', 'bien123'), { ok: true }); await espera()
assert.deepEqual(ses.at(-1), ['a@b.co', 'Norte']); assert.equal(d.sesion.esAdmin(), false)
assert.equal(d.sesion.puede('pagos', 'crear'), true); assert.equal(d.sesion.puede('pagos', 'borrar'), false); assert.equal(d.sesion.alcance('pagos'), 'sede')
assert.equal(d.sesion.puedeAutomatizacion('descargar-pagos'), true); assert.equal(d.sesion.puedeAutomatizacion('respaldo'), false); assert.equal(d.sesion.gestionaUsuarios(), false)
assert.deepEqual(escritorioRecibio.at(-1).info, { id: 'u1', nombre: 'Laura', rol: 'cajero', sede: 'Norte', permisos: undefined, automatizaciones: ['descargar-pagos'], gestionaUsuarios: false })
assert.equal(escritorioRecibio.at(-1).s.user.email, 'a@b.co')
await d.sesion.salir(); await espera(); assert.deepEqual(ses.at(-1), [null, null])
assert.equal(escritorioRecibio.at(-1).info, null)
// conflictos: otro equipo cambió la fila después de que la vi
estado.filas.pagos = [{ id: 1, sede: 'Norte', valor: 10, actualizado: '2026-11-28T10:00:00.000Z' }]
let r = await d.guardar('pagos', { id: 1, valor: 11, actualizado: '2026-11-28T10:00:00.000Z' })
assert.equal(r.ok, true); assert.equal(estado.filas.pagos[0].valor, 11)
const vista = { id: 1, valor: 99, actualizado: '2026-11-28T10:00:00.000Z' } // versión vieja
r = await d.guardar('pagos', vista)
assert.equal(r.ok, false); assert.equal(r.conflicto.servidor.valor, 11); assert.equal(estado.filas.pagos[0].valor, 11, 'no se pisó lo del otro equipo')
let vistosConf = []; d.alConflicto((l) => vistosConf.push(l.length)); assert.equal(d.conflictos().length, 1)
assert.equal((await d.resolverConflicto(0, 'mio')).ok, true); assert.deepEqual(estado.escrituras.at(-1), ['upsert', 'pagos', { id: 1, valor: 99 }]); assert.equal(d.conflictos().length, 0)
// errores: se suben con equipo y versión cuando hay sesión; sin sesión quedan en cola
await d.sesion.entrar('a@b.co', 'bien123'); await espera()
await d.reportarError('interfaz', 'TypeError: x', 'pila'); await d.reportarError('interfaz', 'TypeError: x', 'pila')
assert.equal(estado.insertados.app_errores.length, 1, 'el mismo error en un minuto cuenta una vez')
assert.deepEqual({ ...estado.insertados.app_errores[0], detalle: undefined }, { equipo: 'CAJA-1', version: '1.4.0', origen: 'interfaz', mensaje: 'TypeError: x', detalle: undefined })
// ---------- modo sin internet ----------
estado.filas.pagos = [{ id: 'a', sede: 'Norte', valor: 1 }, { id: 'b', sede: 'Norte', valor: 2 }, { id: 'c', sede: 'Sur', valor: 3 }]
const d3 = crearDatos({ url: 'https://sin-red.supabase.co', clave: 'x' })
assert.deepEqual(await d3.precargar(['pagos']), { pagos: { ok: true, filas: 3 } })
estado.red = false
// una pantalla nueva con un filtro que nunca se abrió con internet: sale de la copia de la tabla completa
let v3 = []; const parar3 = d3.enVivo('pagos', { filtro: { sede: 'Norte' }, orden: 'valor' }, (f, i) => v3.push([f.map((x) => x.id + (x._pendiente ? '*' : '')), i.origen])); await espera()
assert.deepEqual(v3[0], [['a', 'b'], 'copia-local'])
// guardar sin internet: se ve al instante, con id nuevo y marcado como pendiente
const r3 = await d3.guardar('pagos', { sede: 'Norte', valor: 0 }); assert.equal(r3.enCola, true)
const nuevo = d3.cola()[0].fila.id; assert.match(nuevo, /^[0-9a-f-]{36}$/)
assert.deepEqual(v3.at(-1)[0], [nuevo + '*', 'a', 'b'], 'la fila nueva aparece ordenada y pendiente')
await d3.guardar('pagos', { id: 'a', sede: 'Norte', valor: 9 }); assert.deepEqual(v3.at(-1)[0], [nuevo + '*', 'b', 'a*'], 'editar: se ve el cambio')
await d3.borrar('pagos', 'b'); assert.deepEqual(v3.at(-1)[0], [nuevo + '*', 'a*'], 'borrar: desaparece')
assert.equal(d3.pendientes(), 3)
// con cola pendiente, lo nuevo va detrás (aunque vuelva la red) para respetar el orden; un rechazo no tranca lo demás
estado.red = true; estado.rechazar = 'pagos'; estado.escrituras = []
await d3.sincronizar(); assert.equal(d3.pendientes(), 3, 'sin sesión, un "no permitido" espera a que alguien entre')
await d3.sesion.entrar('a@b.co', 'bien123'); await espera(); await d3.sincronizar(); await espera()
assert.equal(d3.pendientes(), 0); assert.equal(d3.rechazados().length, 2, 'los dos guardados rechazados quedan a la vista')
assert.match(d3.rechazados()[0].error, /No tienes permiso/); assert.deepEqual(estado.escrituras, [['delete', 'pagos', 'b']])
estado.rechazar = null; d3.reintentarRechazo(0); await espera(50)
assert.equal(d3.rechazados().length, 1); assert.equal(estado.escrituras.at(-1)[2].id, nuevo)
d3.descartarRechazo(0); assert.equal(d3.rechazados().length, 0)
// todo queda guardado en el equipo: otra instancia (la app reabierta) ve cola, rechazos y conflictos
estado.red = false; await d3.guardar('pagos', { id: 'c', sede: 'Sur', valor: 4 })
const d4 = crearDatos({ url: 'https://sin-red.supabase.co', clave: 'x' }); await d4.listo
assert.equal(d4.pendientes(), 1); assert.equal(d4.cola()[0].fila.id, 'c')
estado.red = true; parar3()
// sin tiempo real (firewall o visor sin WebSocket): recarga sola cada cierto tiempo
estado.sinTiempoReal = true
const d5 = crearDatos({ url: 'https://sin-ws.supabase.co', clave: 'x', opciones: { recargaSinTiempoReal: 40 } })
let v5 = []; const parar5 = d5.enVivo('pagos', {}, (f, i) => v5.push(i.origen)); await espera(30)
estado.filas.pagos.push({ id: 'n', sede: 'Sur', valor: 8 }); await espera(120)
assert.ok(v5.filter((o) => o === 'servidor').length >= 2, 'recargó sin tiempo real'); parar5(); estado.sinTiempoReal = false
parar(); console.log('datos-en-vivo: ok (filtro, orden, insert/update/delete en vivo, copia local, cola, conexión, sesión, sin internet: precarga, cambios visibles al instante, orden, rechazos, persistencia)')
