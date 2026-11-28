import { PGlite } from '@electric-sql/pglite'
import { sqlDeTablas } from '../plugins/dsh-escritorio/tablas.js'
import assert from 'node:assert/strict'
const db = new PGlite()
await db.exec(`
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role authenticated;
grant usage on schema public, auth to authenticated;
alter default privileges in schema public grant all on tables to authenticated;
grant execute on function auth.uid() to authenticated;
create publication supabase_realtime;
`)
const tablas = [
  { nombre: 'Sedes', acceso: 'solo-lectura', columnas: [{ nombre: 'nombre', requerido: true, unico: true }] },
  { nombre: 'Aprendices', acceso: 'por-columna', columnaAcceso: 'sede', columnas: [{ nombre: 'documento', requerido: true, unico: true }, { nombre: 'nombre', requerido: true }, { nombre: 'sede', requerido: true, opciones: ['Norte', 'Sur'] }, { nombre: 'correo', tipo: 'correo' }] },
  { nombre: 'Pagos', acceso: 'por-columna', columnaAcceso: 'sede', columnas: [{ nombre: 'aprendiz', referencia: 'aprendices', requerido: true }, { nombre: 'valor', tipo: 'dinero', requerido: true }, { nombre: 'fecha', tipo: 'fecha', defecto: 'ahora' }, { nombre: 'sede', requerido: true }] },
  { nombre: 'Notas', acceso: 'propietario', columnas: [{ nombre: 'texto' }] },
]
const { sql, tablas: orden } = sqlDeTablas(tablas)
console.log('orden:', orden.join(', '), '·', sql.split('\n').length, 'líneas')
await db.exec(sql)
await db.exec(sql) // repetible
await db.exec(`grant all on all tables in schema public to authenticated;`)
const [norte, sur, admin] = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333']
await db.exec(`insert into auth.users (id, email) values ('${norte}', 'norte@x.co'), ('${sur}', 'sur@x.co'), ('${admin}', 'admin@x.co');
update public.perfiles set sede = 'Norte' where id = '${norte}'; update public.perfiles set sede = 'Sur' where id = '${sur}'; update public.perfiles set rol = 'admin' where id = '${admin}';`)
const como = async (u, q) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${u}', false);`); try { return await db.query(q) } finally { await db.exec('reset role') } }
const intenta = async (u, q) => { try { await como(u, q); return 'ok' } catch (e) { return e.message } }
// perfiles creados solos por el trigger
assert.equal((await db.query('select count(*)::int n from public.perfiles')).rows[0].n, 3)
// por-columna: cada sede lo suyo
assert.equal(await intenta(norte, `insert into public.aprendices (documento, nombre, sede) values ('1', 'Laura', 'Norte')`), 'ok')
assert.match(await intenta(norte, `insert into public.aprendices (documento, nombre, sede) values ('2', 'Pedro', 'Sur')`), /row-level security/)
assert.equal(await intenta(sur, `insert into public.aprendices (documento, nombre, sede) values ('3', 'Ana', 'Sur')`), 'ok')
assert.deepEqual((await como(norte, 'select nombre from public.aprendices')).rows.map((r) => r.nombre), ['Laura'])
assert.equal((await como(admin, 'select count(*)::int n from public.aprendices')).rows[0].n, 2)
assert.match(await intenta(norte, `insert into public.aprendices (documento, nombre, sede) values ('4', 'X', 'Oeste')`), /check|row-level/)
assert.match(await intenta(norte, `insert into public.aprendices (documento, nombre, sede, correo) values ('5', 'Y', 'Norte', 'malo')`), /check/)
// referencia + dinero + fecha por defecto
const idLaura = (await db.query(`select id from public.aprendices where documento = '1'`)).rows[0].id
assert.equal(await intenta(norte, `insert into public.pagos (aprendiz, valor, sede) values ('${idLaura}', 150000.50, 'Norte')`), 'ok')
const pago = (await db.query('select fecha, creado_por, valor from public.pagos')).rows[0]
assert.ok(pago.fecha); assert.equal(pago.creado_por, norte); assert.equal(String(pago.valor), '150000.50')
// solo-lectura: todos leen, solo admin escribe
assert.match(await intenta(norte, `insert into public.sedes (nombre) values ('Norte')`), /row-level security/)
assert.equal(await intenta(admin, `insert into public.sedes (nombre) values ('Norte')`), 'ok')
assert.equal((await como(sur, 'select count(*)::int n from public.sedes')).rows[0].n, 1)
// propietario
await como(norte, `insert into public.notas (texto) values ('mía')`)
assert.equal((await como(sur, 'select count(*)::int n from public.notas')).rows[0].n, 0)
assert.equal((await como(norte, 'select count(*)::int n from public.notas')).rows[0].n, 1)
// el usuario no puede hacerse admin
await como(norte, `update public.perfiles set rol = 'admin' where id = '${norte}'`)
assert.equal((await db.query(`select rol from public.perfiles where id = '${norte}'`)).rows[0].rol, 'usuario')
// actualizado automático y tiempo real
await db.exec(`update public.aprendices set nombre = 'Laura M.' where documento = '1'`)
const a = (await db.query(`select creado, actualizado from public.aprendices where documento = '1'`)).rows[0]
assert.ok(a.actualizado >= a.creado)
const pub = (await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)).rows.map((r) => r.tablename)
assert.deepEqual(pub, ['aprendices', 'notas', 'pagos', 'sedes'])
// cambiar acceso no deja la tabla abierta
const { sql: sql2 } = sqlDeTablas([{ ...tablas[3], acceso: 'autenticados' }])
await db.exec(sql2); assert.equal((await como(sur, 'select count(*)::int n from public.notas')).rows[0].n, 1)
const { sql: sql3 } = sqlDeTablas([{ ...tablas[3], acceso: 'propietario' }])
await db.exec(sql3); assert.equal((await como(sur, 'select count(*)::int n from public.notas')).rows[0].n, 0, 'al volver a propietario se cierra otra vez')
// errores
assert.throws(() => sqlDeTablas([{ nombre: 'x', columnas: [{ nombre: 'id' }] }]), /la agrega el plugin/)
assert.throws(() => sqlDeTablas([{ nombre: 'x', acceso: 'por-columna', columnas: [{ nombre: 'a' }] }]), /"sede", que no está/)
assert.throws(() => sqlDeTablas([{ nombre: 'x', columnas: [{ nombre: 'a', referencia: 'y' }] }]), /"y", que no está/)
assert.throws(() => sqlDeTablas([{ nombre: 'order', columnas: [{ nombre: 'a' }] }]), /reservada/)
console.log('sql: ok (RLS por sede, propietario, solo-lectura, perfiles, tiempo real, repetible)')
