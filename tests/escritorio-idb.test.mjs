// La copia local usa IndexedDB cuando existe (en la app de escritorio siempre): se guarda, sobrevive a reabrir y
// sigue leyendo lo que versiones anteriores dejaron en localStorage.
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const ls = new Map(); globalThis.localStorage = { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v) }
globalThis.window = { addEventListener() {}, removeEventListener() {} }
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
const aqui = path.dirname(fileURLToPath(import.meta.url))
const tmp = await mkdtemp(path.join(os.tmpdir(), 'datos-idb-'))
await copyFile(path.join(aqui, 'fixtures/supabase-falso.mjs'), path.join(tmp, 'falso.mjs'))
await writeFile(path.join(tmp, 'dev.mjs'), (await readFile(path.join(aqui, '../plugins/dsh-escritorio/web/datos-en-vivo.js'), 'utf8')).replace("from '@supabase/supabase-js'", "from './falso.mjs'"))
const { estado } = await import(pathToFileURL(path.join(tmp, 'falso.mjs')).href); const { crearDatos } = await import(pathToFileURL(path.join(tmp, 'dev.mjs')).href)
const espera = (ms = 40) => new Promise((r) => setTimeout(r, ms))
ls.set('datos:idb.supabase.co:viejo:{}', JSON.stringify([{ id: 'v' }])) // dejado por la 0.7
const d = crearDatos({ url: 'https://idb.supabase.co', clave: 'x' }); await d.listo
assert.deepEqual((await d.precargar(['pagos'])).pagos.ok, true)
estado.red = false
await d.guardar('pagos', { id: 'z', sede: 'Norte', valor: 1 }); await espera()
assert.equal(ls.has('datos:idb.supabase.co:cola'), false, 'la cola va a IndexedDB, no a localStorage')
const d2 = crearDatos({ url: 'https://idb.supabase.co', clave: 'x' }); await d2.listo
assert.equal(d2.pendientes(), 1, 'la cola sobrevive a reabrir la app')
const v = []; d2.enVivo('pagos', {}, (f) => v.push(f.length)); await espera()
assert.equal(v[0], estado.filas.pagos.length + 1, 'copia de la tabla + lo pendiente')
const v2 = []; d2.enVivo('viejo', {}, (f) => v2.push(f.map((x) => x.id))); await espera()
assert.deepEqual(v2[0], ['v'], 'lee la copia que dejó la versión anterior')
console.log('copia local en IndexedDB: ok (cola y tablas sobreviven a reabrir, lee lo de la 0.7)')
process.exit(0)
