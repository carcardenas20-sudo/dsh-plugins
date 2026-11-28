// La función del servidor que crea y administra usuarios (Supabase Edge Function), con un Supabase simulado.
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const aqui = path.dirname(fileURLToPath(import.meta.url))
const tmp = await mkdtemp(path.join(os.tmpdir(), 'funcion-'))
await copyFile(path.join(aqui, 'fixtures/supabase-servidor-falso.mjs'), path.join(tmp, 'falso-servidor.mjs'))
await writeFile(path.join(tmp, 'funcion.ts'), (await readFile(path.join(aqui, '../plugins/dsh-escritorio/web/funcion-usuarios.ts'), 'utf8')).replace("from 'npm:@supabase/supabase-js@2'", "from './falso-servidor.mjs'"))
const { bd } = await import(pathToFileURL(path.join(tmp, 'falso-servidor.mjs')).href)
const { manejar } = await import(pathToFileURL(path.join(tmp, 'funcion.ts')).href)
bd.perfiles.push({ id: 'admin1', nombre: 'Admin', rol: 'admin', activo: true }, { id: 'ger1', nombre: 'Gerente', rol: 'gerente', activo: true }, { id: 'caj1', nombre: 'Caja', rol: 'cajero', activo: true })
bd.usuarios.push({ id: 'admin1', email: 'admin@x.co' }, { id: 'ger1', email: 'g@x.co' }, { id: 'caj1', email: 'c@x.co' })
Object.assign(bd.tokens, { TA: 'admin1', TG: 'ger1', TC: 'caj1' })
const env = { url: 'u', servicio: 's', anon: 'a' }
const pedir = async (tok, cuerpo) => { const r = await manejar(new Request('http://x', { method: 'POST', headers: tok ? { Authorization: `Bearer ${tok}` } : {}, body: JSON.stringify(cuerpo) }), env); return { estado: r.status, ...(await r.json()) } }
assert.equal((await pedir(null, { accion: 'listar' })).estado, 401)
assert.equal((await pedir('XX', { accion: 'listar' })).estado, 401)
assert.match((await pedir('TC', { accion: 'listar' })).error, /no puede administrar/)
const l = await pedir('TG', { accion: 'listar' }); assert.equal(l.usuarios.length, 3); assert.equal(l.usuarios.find((u) => u.id === 'ger1').soyYo, true)
// crear
let r = await pedir('TG', { accion: 'crear', correo: 'Caja2@X.co ', clave: 'clave-segura', nombre: 'Caja 2', rol: 'cajero', campos: { sede: 'Norte', rol: 'admin', 'mal campo': 'x' } })
assert.equal(r.ok, true); const nuevo = bd.perfiles.find((p) => p.id === r.id)
assert.equal(nuevo.rol, 'cajero', 'campos no puede colar el rol'); assert.equal(nuevo.sede, 'Norte'); assert.equal(nuevo.correo, 'caja2@x.co')
assert.match((await pedir('TG', { accion: 'crear', correo: 'caja2@x.co', clave: 'clave-segura', rol: 'cajero' })).error, /Ya existe/)
assert.match((await pedir('TG', { accion: 'crear', correo: 'x@x.co', clave: 'corta', rol: 'cajero' })).error, /8 caracteres/)
assert.match((await pedir('TG', { accion: 'crear', correo: 'x@x.co', clave: 'clave-segura', rol: 'admin' })).error, /Solo un administrador/)
assert.match((await pedir('TG', { accion: 'crear', correo: 'x@x.co', clave: 'clave-segura', rol: 'piloto' })).error, /no existe/)
assert.equal((await pedir('TA', { accion: 'crear', correo: 'admin2@x.co', clave: 'clave-segura', rol: 'admin' })).ok, true)
// actualizar
assert.equal((await pedir('TG', { accion: 'actualizar', id: r.id, campos: { sede: 'Sur' } })).ok, true); assert.equal(nuevo.sede, 'Sur')
assert.match((await pedir('TG', { accion: 'actualizar', id: 'ger1', rol: 'cajero' })).error, /propio rol/)
assert.match((await pedir('TG', { accion: 'actualizar', id: 'admin1', nombre: 'x' })).error, /Solo un administrador puede modificar/)
assert.match((await pedir('TG', { accion: 'actualizar', id: 'caj1', rol: 'admin' })).error, /nombrar administradores/)
assert.equal((await pedir('TG', { accion: 'actualizar', id: 'caj1', activo: false })).ok, true); assert.equal(bd.baneos.caj1, '876000h')
assert.match((await pedir('TC', { accion: 'listar' })).error, /desactivado/)
assert.equal((await pedir('TG', { accion: 'actualizar', id: 'caj1', activo: true })).ok, true); assert.equal(bd.baneos.caj1, 'none')
// clave y borrar
assert.equal((await pedir('TG', { accion: 'clave', id: 'caj1', clave: 'otra-clave-1' })).ok, true)
assert.match((await pedir('TG', { accion: 'borrar', id: 'caj1' })).error, /Solo un administrador/)
assert.match((await pedir('TA', { accion: 'borrar', id: 'admin1' })).error, /a ti mismo/)
assert.equal((await pedir('TA', { accion: 'borrar', id: 'caj1' })).ok, true); assert.ok(!bd.perfiles.find((p) => p.id === 'caj1'))
assert.equal((await manejar(new Request('http://x', { method: 'OPTIONS' }), env)).status, 200)
console.log('funcion-usuarios: ok (sesión, permisos de gestor vs admin, crear, actualizar, desactivar, clave, borrar)')
