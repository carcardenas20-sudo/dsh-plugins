// El SQL generado por dsh-escritorio corre en un Postgres real (PGlite) con las piezas de Supabase simuladas,
// y se comprueban los permisos por rol, alcance (sede/propio/todo), usuarios y automatizaciones.
import { PGlite } from '@electric-sql/pglite'
import assert from 'node:assert/strict'
import { envolverMigracion, sqlDeCambios, sqlDeTablas } from '../plugins/dsh-escritorio/tablas.js'

const db = new PGlite()
await db.exec(`
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role authenticated; create role anon;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
create publication supabase_realtime;
`)
const tablas = [
  { nombre: 'Aprendices', columnaAcceso: 'sede', columnas: [{ nombre: 'documento', requerido: true, unico: true }, { nombre: 'nombre', requerido: true }, { nombre: 'sede', requerido: true, opciones: ['Norte', 'Sur'] }, { nombre: 'correo', tipo: 'correo' }] },
  { nombre: 'Pagos', columnaAcceso: 'sede', columnas: [{ nombre: 'aprendiz', referencia: 'aprendices', requerido: true }, { nombre: 'valor', tipo: 'dinero', requerido: true }, { nombre: 'fecha', tipo: 'fecha', defecto: 'ahora' }, { nombre: 'sede', requerido: true }] },
  { nombre: 'Notas', columnas: [{ nombre: 'texto' }] },
]
const roles = [
  { nombre: 'cajero', descripcion: 'Caja de cada sede', permisos: { pagos: { acciones: ['leer', 'crear'], alcance: 'sede' }, aprendices: { acciones: ['leer'], alcance: 'sede' } }, automatizaciones: ['descargar-pagos'] },
  { nombre: 'gerente', permisos: { aprendices: { acciones: ['leer', 'crear', 'cambiar', 'borrar'], alcance: 'todo' }, pagos: ['leer'] }, automatizaciones: ['*'], gestionaUsuarios: true },
  { nombre: 'instructor', permisos: { notas: { acciones: ['leer', 'crear', 'cambiar', 'borrar'], alcance: 'propio' } } },
]
const { sql, tablas: orden, roles: nombresRoles } = sqlDeTablas(tablas, { roles })
assert.deepEqual(orden, ['aprendices', 'pagos', 'notas']); assert.deepEqual(nombresRoles, ['admin', 'cajero', 'gerente', 'instructor'])
await db.exec(sql)
await db.exec(sql) // repetible
await db.exec('grant all on all tables in schema public to authenticated;')

const U = { cajaN: '11111111-1111-1111-1111-111111111111', cajaS: '22222222-2222-2222-2222-222222222222', admin: '33333333-3333-3333-3333-333333333333', gerente: '44444444-4444-4444-4444-444444444444', instr: '55555555-5555-5555-5555-555555555555', instr2: '66666666-6666-6666-6666-666666666666' }
// usuarios creados "desde la app": el rol y la sede llegan en app_metadata
await db.exec(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('${U.cajaN}', 'caja.norte@x.co', '{"nombre":"Caja Norte"}', '{"rol":"cajero","sede":"Norte"}'),
  ('${U.cajaS}', 'caja.sur@x.co', '{}', '{"rol":"cajero","sede":"Sur"}'),
  ('${U.admin}', 'admin@x.co', '{}', '{}'),
  ('${U.gerente}', 'gerente@x.co', '{}', '{"rol":"gerente"}'),
  ('${U.instr}', 'i1@x.co', '{}', '{"rol":"instructor"}'), ('${U.instr2}', 'i2@x.co', '{}', '{"rol":"instructor"}');
update public.perfiles set rol = 'admin' where correo = 'admin@x.co';`)
const p = (await db.query(`select nombre, rol, sede, correo from public.perfiles where id = '${U.cajaN}'`)).rows[0]
assert.deepEqual(p, { nombre: 'Caja Norte', rol: 'cajero', sede: 'Norte', correo: 'caja.norte@x.co' })
assert.equal((await db.query(`select rol from public.perfiles where id = '${U.cajaS}'`)).rows[0].rol, 'cajero')
assert.equal((await db.query(`select rol from public.perfiles where correo = 'i1@x.co'`)).rows[0].rol, 'instructor')

const como = async (u, q) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${u}', false);`); try { return await db.query(q) } finally { await db.exec('reset role') } }
const intenta = async (u, q) => { try { await como(u, q); return 'ok' } catch (e) { return e.message } }
const cuenta = async (u, t) => (await como(u, `select count(*)::int n from public.${t}`)).rows[0].n

// datos base (como admin)
assert.equal(await intenta(U.admin, `insert into public.aprendices (documento, nombre, sede) values ('1', 'Laura', 'Norte'), ('2', 'Pedro', 'Sur')`), 'ok')
const idLaura = (await db.query(`select id from public.aprendices where documento = '1'`)).rows[0].id
const idPedro = (await db.query(`select id from public.aprendices where documento = '2'`)).rows[0].id

// cajero: lee y crea pagos solo de su sede, no cambia ni borra, no crea aprendices
assert.equal(await intenta(U.cajaN, `insert into public.pagos (aprendiz, valor, sede) values ('${idLaura}', 150000.50, 'Norte')`), 'ok')
assert.match(await intenta(U.cajaN, `insert into public.pagos (aprendiz, valor, sede) values ('${idPedro}', 10, 'Sur')`), /row-level security/)
assert.equal(await intenta(U.cajaS, `insert into public.pagos (aprendiz, valor, sede) values ('${idPedro}', 20000, 'Sur')`), 'ok')
assert.equal(await cuenta(U.cajaN, 'pagos'), 1); assert.equal(await cuenta(U.cajaN, 'aprendices'), 1)
assert.match(await intenta(U.cajaN, `insert into public.aprendices (documento, nombre, sede) values ('3', 'X', 'Norte')`), /row-level security/)
await como(U.cajaN, `update public.pagos set valor = 1`)
assert.equal(String((await db.query(`select valor from public.pagos where sede = 'Norte'`)).rows[0].valor), '150000.50', 'sin permiso de cambiar, el update no toca nada')
const pago = (await db.query(`select fecha, creado_por from public.pagos where sede = 'Norte'`)).rows[0]
assert.ok(pago.fecha); assert.equal(pago.creado_por, U.cajaN)

// gerente: todos los aprendices (lee, crea, cambia), pagos solo leer
assert.equal(await cuenta(U.gerente, 'aprendices'), 2); assert.equal(await cuenta(U.gerente, 'pagos'), 2)
assert.equal(await intenta(U.gerente, `insert into public.aprendices (documento, nombre, sede) values ('3', 'Ana', 'Sur')`), 'ok')
assert.match(await intenta(U.gerente, `insert into public.pagos (aprendiz, valor, sede) values ('${idPedro}', 5, 'Sur')`), /row-level security/)
// el gerente gestiona usuarios: cambia la sede de un cajero, pero no nombra admins ni se cambia su rol
assert.equal(await intenta(U.gerente, `update public.perfiles set sede = 'Sur' where id = '${U.cajaN}'`), 'ok')
assert.equal(await cuenta(U.cajaN, 'pagos'), 1, 'ahora Caja Norte ve los pagos de Sur (el suyo de Norte ya no)')
assert.equal((await como(U.cajaN, 'select sede from public.pagos')).rows[0].sede, 'Sur')
await db.exec(`update public.perfiles set sede = 'Norte' where id = '${U.cajaN}'`)
assert.match(await intenta(U.gerente, `update public.perfiles set rol = 'admin' where id = '${U.cajaN}'`), /Solo un administrador/)
assert.match(await intenta(U.gerente, `update public.perfiles set rol = 'cajero' where id = '${U.gerente}'`), /tu propio rol/)
assert.equal(await cuenta(U.gerente, 'perfiles'), 6)
// un usuario normal no ve otros perfiles ni se sube de rol
assert.equal(await cuenta(U.cajaN, 'perfiles'), 1)
await como(U.cajaN, `update public.perfiles set rol = 'gerente' where id = '${U.cajaN}'`)
assert.equal((await db.query(`select rol from public.perfiles where id = '${U.cajaN}'`)).rows[0].rol, 'cajero')

// instructor: solo sus notas
await como(U.instr, `insert into public.notas (texto) values ('mía')`)
assert.equal(await cuenta(U.instr, 'notas'), 1); assert.equal(await cuenta(U.instr2, 'notas'), 0); assert.equal(await cuenta(U.cajaN, 'notas'), 0)

// el admin cambia permisos desde la app y aplican al instante, sin tocar SQL
assert.match(await intenta(U.gerente, `update public.roles set permisos = '{}' where nombre = 'cajero'`), /^ok$/) // no falla, pero RLS no deja tocar
assert.equal((await db.query(`select permisos ? 'pagos' p from public.roles where nombre = 'cajero'`)).rows[0].p, true)
assert.equal(await intenta(U.admin, `update public.roles set permisos = jsonb_set(permisos, '{pagos,acciones}', '["leer","crear","cambiar"]') where nombre = 'cajero'`), 'ok')
await como(U.cajaN, `update public.pagos set valor = 160000`)
assert.equal(String((await db.query(`select valor from public.pagos where sede = 'Norte'`)).rows[0].valor), '160000.00')
// usuario desactivado: no ve nada
await db.exec(`update public.perfiles set activo = false where id = '${U.cajaS}'`)
assert.equal(await cuenta(U.cajaS, 'pagos'), 0)
// volver a correr el SQL conserva lo que el admin cambió
await db.exec(sql)
assert.deepEqual((await db.query(`select permisos->'pagos'->'acciones' a from public.roles where nombre = 'cajero'`)).rows[0].a, ['leer', 'crear', 'cambiar'])

// automatizaciones: permiso por rol y turnos (una tarea programada corre en un solo equipo)
const puedeAuto = async (u, id) => (await como(u, `select public.puede_automatizacion('${id}') p`)).rows[0].p
assert.equal(await puedeAuto(U.cajaN, 'descargar-pagos'), true); assert.equal(await puedeAuto(U.cajaN, 'respaldo'), false)
assert.equal(await puedeAuto(U.gerente, 'respaldo'), true); assert.equal(await puedeAuto(U.instr, 'descargar-pagos'), false)
const clave = 'descargar-pagos@2026-11-28T23:00:00.000Z'
assert.equal(await intenta(U.cajaN, `insert into public.automatizacion_turnos (clave, equipo) values ('${clave}', 'CAJA-NORTE')`), 'ok')
assert.match(await intenta(U.gerente, `insert into public.automatizacion_turnos (clave, equipo) values ('${clave}', 'GERENCIA')`), /duplicate key/)
assert.match(await intenta(U.instr, `insert into public.automatizacion_turnos (clave, equipo) values ('descargar-pagos@otra', 'X')`), /row-level security/)
assert.equal(await intenta(U.cajaN, `insert into public.automatizacion_corridas (automatizacion, equipo, ok) values ('descargar-pagos', 'CAJA-NORTE', true)`), 'ok')
assert.equal(await cuenta(U.gerente, 'automatizacion_corridas'), 1); assert.equal(await cuenta(U.instr, 'automatizacion_corridas'), 0)

// versión mínima: las apps viejas no pueden escribir (la web y el SQL Editor sí)
const conVersion = async (u, v, q) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${u}', false); select set_config('request.headers', '${JSON.stringify({ 'x-app-version': v, 'x-equipo': 'CAJA-NORTE' })}', false);`); try { return await db.query(q) } finally { await db.exec("reset role; select set_config('request.headers', '', false)") } }
const intentaV = async (u, v, q) => { try { await conVersion(u, v, q); return 'ok' } catch (e) { return e.message } }
assert.match(await intenta(U.gerente, `insert into public.app_config (clave, valor) values ('version_minima', '1.3.0')`), /row-level security/)
await como(U.admin, `insert into public.app_config (clave, valor) values ('version_minima', '1.3.0')`)
assert.match(await intentaV(U.cajaN, '1.2.9', `insert into public.pagos (aprendiz, valor, sede) values ('${idLaura}', 1, 'Norte')`), /row-level security/)
assert.equal(await intentaV(U.cajaN, '1.10.0', `insert into public.pagos (aprendiz, valor, sede) values ('${idLaura}', 2, 'Norte')`), 'ok', '1.10.0 es mayor que 1.3.0 (no comparación de texto)')
assert.equal((await conVersion(U.cajaN, '1.0.0', 'select count(*)::int n from public.pagos')).rows[0].n, 2, 'leer sí puede, para que vea el aviso')
await db.exec("delete from public.app_config")
// auditoría: quién cambió qué, desde qué equipo
const aud = (await db.query(`select tabla, accion, usuario, equipo, antes->>'valor' antes, despues->>'valor' despues from public.auditoria where tabla = 'pagos' order by id`)).rows
assert.ok(aud.length >= 3); assert.equal(aud.at(-1).equipo, 'CAJA-NORTE'); assert.equal(aud.at(-1).usuario, U.cajaN)
assert.ok(aud.some((x) => x.accion === 'update' && x.antes === '150000.50' && x.despues === '160000.00'))
assert.equal((await como(U.cajaN, 'select count(*)::int n from public.auditoria')).rows[0].n, 0, 'solo quien gestiona ve la auditoría')
assert.ok((await como(U.gerente, 'select count(*)::int n from public.auditoria')).rows[0].n > 0)
const antesUpd = (await db.query('select count(*)::int n from public.auditoria')).rows[0].n
await db.exec(`update public.pagos set valor = valor`)
assert.equal((await db.query('select count(*)::int n from public.auditoria')).rows[0].n, antesUpd, 'un update que no cambia nada no ensucia la auditoría')
// errores de los equipos
assert.equal(await intenta(U.cajaN, `insert into public.app_errores (equipo, version, origen, mensaje) values ('CAJA-NORTE', '1.2.0', 'interfaz', 'TypeError: x is undefined')`), 'ok')
assert.equal((await como(U.cajaN, 'select count(*)::int n from public.app_errores')).rows[0].n, 0); assert.equal((await como(U.gerente, 'select count(*)::int n from public.app_errores')).rows[0].n, 1)

// migraciones: se aplican una vez y quedan registradas; los cambios destructivos dejan copia
const m1 = envolverMigracion('002_cambios', sqlDeCambios([{ tipo: 'renombrar-columna', tabla: 'aprendices', de: 'correo', a: 'email' }, { tipo: 'quitar-columna', tabla: 'notas', columna: 'texto', confirmar: true }], { fecha: new Date('2026-11-28') }).sql, 'renombra correo y quita notas.texto')
await db.exec(m1); await db.exec(m1)
const colsAp = (await db.query(`select column_name from information_schema.columns where table_name = 'aprendices'`)).rows.map((r) => r.column_name)
assert.ok(colsAp.includes('email') && !colsAp.includes('correo'))
assert.equal((await db.query(`select texto from public.respaldo_notas_texto_20261128`)).rows[0].texto, 'mía')
assert.deepEqual((await db.query('select nombre from public.migraciones')).rows.map((r) => r.nombre), ['002_cambios'])
const m2 = envolverMigracion('003_tabla', sqlDeCambios([{ tipo: 'renombrar-tabla', de: 'notas', a: 'apuntes' }]).sql)
await db.exec(m2)
assert.deepEqual((await db.query(`select permisos->'apuntes' p from public.roles where nombre = 'instructor'`)).rows[0].p, { acciones: ['leer', 'crear', 'cambiar', 'borrar'], alcance: 'propio' }, 'los permisos siguen a la tabla renombrada')
assert.throws(() => sqlDeCambios([{ tipo: 'quitar-columna', tabla: 'pagos', columna: 'valor' }]), /confirmar/)
assert.throws(() => sqlDeCambios([{ tipo: 'renombrar-tabla', de: 'roles', a: 'x' }]), /es del plugin/)

// tiempo real
const pub = (await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)).rows.map((r) => r.tablename)
assert.deepEqual(pub, ['aprendices', 'apuntes', 'automatizacion_corridas', 'pagos'])

// sin roles: se deducen del acceso de cada tabla (compatibilidad con 0.4)
const db2 = new PGlite()
await db2.exec(`create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$; create role authenticated; create role anon; create publication supabase_realtime;`)
const s2 = sqlDeTablas([{ nombre: 'pagos', acceso: 'por-columna', columnas: [{ nombre: 'sede' }] }, { nombre: 'tarifas', acceso: 'solo-lectura', columnas: [{ nombre: 'valor', tipo: 'dinero' }] }])
await db2.exec(s2.sql)
const usuario = (await db2.query(`select permisos from public.roles where nombre = 'usuario'`)).rows[0].permisos
assert.deepEqual(usuario, { pagos: { acciones: ['leer', 'crear', 'cambiar', 'borrar'], alcance: 'sede' }, tarifas: { acciones: ['leer'], alcance: 'todo' } })

// errores claros
assert.throws(() => sqlDeTablas([{ nombre: 'x', columnas: [{ nombre: 'id' }] }]), /la agrega el plugin/)
assert.throws(() => sqlDeTablas([{ nombre: 'x', acceso: 'por-columna', columnas: [{ nombre: 'a' }] }]), /"sede" no está/)
assert.throws(() => sqlDeTablas([{ nombre: 'x', columnas: [{ nombre: 'a', referencia: 'y' }] }]), /"y", que no está/)
assert.throws(() => sqlDeTablas([{ nombre: 'roles', columnas: [{ nombre: 'a' }] }]), /la crea el plugin/)
assert.throws(() => sqlDeTablas([{ nombre: 'x', columnas: [{ nombre: 'a' }] }], { roles: [{ nombre: 'r', permisos: { x: { acciones: ['volar'] } } }] }), /acción "volar"/)
assert.throws(() => sqlDeTablas([{ nombre: 'x', columnas: [{ nombre: 'a' }] }], { roles: [{ nombre: 'r', permisos: { x: { acciones: ['leer'], alcance: 'sede' } } }] }), /necesita que la tabla tenga columnaAcceso/)
console.log('sql: ok (roles, alcance sede/propio/todo, gestión de usuarios sin escalar, permisos editables en vivo, desactivados, automatizaciones y turnos, tiempo real, repetible)')
