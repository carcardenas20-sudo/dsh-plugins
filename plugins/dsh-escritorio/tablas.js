// Genera el SQL de Supabase para una app de varios equipos: tablas, usuarios con roles y permisos por fila,
// permisos de automatizaciones y registro de corridas. Todo es repetible: correrlo dos veces no rompe nada.
//
// Los permisos viven como datos (tabla "roles"), así el administrador los cambia desde la app sin tocar SQL:
//   roles.permisos = { "<tabla>": { "acciones": ["leer","crear","cambiar","borrar"], "alcance": "todo" | "sede" | "propio" } }
//   roles.automatizaciones = ['descargar-pagos', …] o ['*'] · roles.gestiona_usuarios = true/false
// "sede" significa: la columna de acceso de la tabla (sede, área…) igual a la del perfil del usuario.

const TIPOS = {
  texto: 'text', numero: 'numeric', entero: 'integer', dinero: 'numeric(14,2)', fecha: 'date', fechahora: 'timestamptz',
  booleano: 'boolean', 'si-no': 'boolean', json: 'jsonb', uuid: 'uuid', correo: 'text', telefono: 'text',
}
const RESERVADAS = new Set(['user', 'order', 'group', 'table', 'select', 'from', 'where', 'limit', 'offset', 'default', 'check', 'primary', 'references', 'all', 'and', 'or', 'not', 'null', 'true', 'false', 'end', 'case', 'when', 'to', 'grant', 'column'])
const AUTOMATICAS = new Set(['id', 'creado_por', 'creado', 'actualizado'])
const PROPIAS = new Set(['perfiles', 'roles', 'automatizacion_turnos', 'automatizacion_corridas', 'app_config', 'app_errores', 'auditoria', 'migraciones'])
export const ACCESOS = ['autenticados', 'propietario', 'por-columna', 'solo-lectura']
export const ACCIONES = ['leer', 'crear', 'cambiar', 'borrar']
export const ALCANCES = ['todo', 'sede', 'propio']

export const nombreSql = (s, que) => {
  const n = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!/^[a-z][a-z0-9_]{0,50}$/.test(n)) throw new Error(`${que} "${s}" no es un nombre válido (letras, números y _)`)
  if (RESERVADAS.has(n)) throw new Error(`${que} "${n}" es una palabra reservada de SQL; usa otro nombre`)
  return n
}
const literal = (v) => (v === null ? 'null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
const jsonSql = (v) => `${literal(JSON.stringify(v))}::jsonb`
const arregloSql = (a) => `array[${a.map(literal).join(', ')}]::text[]`

export function normalizarTablas(tablas) {
  if (!Array.isArray(tablas) || !tablas.length) throw new Error('"tablas" debe ser una lista con al menos una tabla')
  const nombres = new Set()
  const salida = tablas.map((t) => {
    const nombre = nombreSql(t.nombre, 'La tabla')
    if (PROPIAS.has(nombre)) throw new Error(`"${nombre}" la crea el plugin; usa otro nombre`)
    if (nombres.has(nombre)) throw new Error(`tabla repetida: ${nombre}`)
    nombres.add(nombre)
    const acceso = t.acceso || 'autenticados'
    if (!ACCESOS.includes(acceso)) throw new Error(`${nombre}: acceso "${acceso}" no existe (usa ${ACCESOS.join(', ')})`)
    const cols = new Set()
    const columnas = (t.columnas || []).map((c) => {
      const n = nombreSql(c.nombre, `La columna de ${nombre}`)
      if (AUTOMATICAS.has(n)) throw new Error(`${nombre}.${n} la agrega el plugin solo (id, creado_por, creado, actualizado)`)
      if (cols.has(n)) throw new Error(`${nombre}: columna repetida ${n}`)
      cols.add(n)
      const tipo = c.referencia ? 'uuid' : TIPOS[c.tipo || 'texto']
      if (!tipo) throw new Error(`${nombre}.${n}: tipo "${c.tipo}" no existe (usa ${Object.keys(TIPOS).join(', ')})`)
      return { ...c, nombre: n, tipo, tipoOriginal: c.tipo || 'texto', referencia: c.referencia ? nombreSql(c.referencia, `La referencia de ${nombre}.${n}`) : null, opciones: Array.isArray(c.opciones) && c.opciones.length ? c.opciones.map(String) : null }
    })
    if (!columnas.length) throw new Error(`${nombre}: no tiene columnas`)
    let columnaAcceso = null
    if (t.columnaAcceso || acceso === 'por-columna') {
      columnaAcceso = nombreSql(t.columnaAcceso || 'sede', `La columna de acceso de ${nombre}`)
      if (!cols.has(columnaAcceso)) throw new Error(`${nombre}: la columna de acceso "${columnaAcceso}" no está entre sus columnas`)
    }
    return { nombre, acceso, columnaAcceso, columnas, auditar: t.auditar !== false }
  })
  for (const t of salida) for (const c of t.columnas) if (c.referencia && !nombres.has(c.referencia)) throw new Error(`${t.nombre}.${c.nombre} apunta a "${c.referencia}", que no está en esta lista de tablas`)
  return salida
}

/** Permisos del rol "usuario" deducidos del "acceso" de cada tabla (cuando no se definen roles). */
function permisosPorAcceso(tablas) {
  const p = {}
  for (const t of tablas) {
    p[t.nombre] = t.acceso === 'solo-lectura' ? { acciones: ['leer'], alcance: 'todo' }
      : { acciones: [...ACCIONES], alcance: t.acceso === 'propietario' ? 'propio' : t.acceso === 'por-columna' ? 'sede' : 'todo' }
  }
  return p
}

export function normalizarRoles(roles, tablas) {
  const nombresTablas = new Set(tablas.map((t) => t.nombre))
  const lista = Array.isArray(roles) && roles.length ? roles : [{ nombre: 'usuario', descripcion: 'Usuario normal', permisos: permisosPorAcceso(tablas), automatizaciones: ['*'] }]
  const vistos = new Set(['admin'])
  const salida = [{ nombre: 'admin', descripcion: 'Administrador: todo, incluidos usuarios y roles', permisos: {}, automatizaciones: ['*'], gestionaUsuarios: true }]
  for (const r of lista) {
    const nombre = nombreSql(r.nombre, 'El rol')
    if (nombre === 'admin') continue // siempre existe y lo puede todo
    if (vistos.has(nombre)) throw new Error(`rol repetido: ${nombre}`)
    vistos.add(nombre)
    const permisos = {}
    for (const [tabla, p] of Object.entries(r.permisos || {})) {
      const nt = nombreSql(tabla, `La tabla en los permisos de ${nombre}`)
      if (!nombresTablas.has(nt)) throw new Error(`rol ${nombre}: la tabla "${nt}" no está en la lista de tablas`)
      const acciones = (Array.isArray(p) ? p : p.acciones || []).map(String)
      for (const a of acciones) if (!ACCIONES.includes(a)) throw new Error(`rol ${nombre}, ${nt}: acción "${a}" no existe (usa ${ACCIONES.join(', ')})`)
      const alcance = (Array.isArray(p) ? 'todo' : p.alcance) || 'todo'
      if (!ALCANCES.includes(alcance)) throw new Error(`rol ${nombre}, ${nt}: alcance "${alcance}" no existe (usa ${ALCANCES.join(', ')})`)
      if (alcance === 'sede' && !tablas.find((t) => t.nombre === nt).columnaAcceso) throw new Error(`rol ${nombre}, ${nt}: alcance "sede" necesita que la tabla tenga columnaAcceso`)
      permisos[nt] = { acciones: [...new Set(acciones)], alcance }
    }
    salida.push({ nombre, descripcion: r.descripcion || '', permisos, automatizaciones: (r.automatizaciones || []).map(String), gestionaUsuarios: !!r.gestionaUsuarios })
  }
  return salida
}

export function sqlDeTablas(tablasEntrada, { roles: rolesEntrada } = {}) {
  const tablas = normalizarTablas(tablasEntrada)
  const roles = normalizarRoles(rolesEntrada, tablas)
  const columnasPerfil = [...new Set(tablas.filter((t) => t.columnaAcceso).map((t) => t.columnaAcceso))]
  const orden = []
  const visitar = (t, camino = new Set()) => {
    if (orden.includes(t)) return
    if (camino.has(t.nombre)) throw new Error(`referencias circulares entre tablas (${[...camino, t.nombre].join(' → ')})`)
    camino.add(t.nombre)
    for (const c of t.columnas) if (c.referencia && c.referencia !== t.nombre) visitar(tablas.find((x) => x.nombre === c.referencia), camino)
    camino.delete(t.nombre)
    orden.push(t)
  }
  tablas.forEach((t) => visitar(t))
  const definer = 'language sql stable security definer set search_path = public'

  const L = []
  L.push('-- Generado por dsh-escritorio. Pégalo en Supabase → SQL Editor → Run (se puede correr varias veces).', '')
  L.push('-- ============ Roles: qué puede hacer cada rol (editable desde la app por el administrador) ============',
    'create table if not exists public.roles (',
    '  nombre text primary key,',
    '  descripcion text,',
    "  permisos jsonb not null default '{}'::jsonb,",
    "  automatizaciones text[] not null default '{}'::text[],",
    '  gestiona_usuarios boolean not null default false,',
    '  creado timestamptz not null default now()',
    ');')
  for (const r of roles) {
    // los roles nuevos se crean; los que ya existen conservan lo que el admin cambió en la app
    L.push(`insert into public.roles (nombre, descripcion, permisos, automatizaciones, gestiona_usuarios) values (${literal(r.nombre)}, ${literal(r.descripcion)}, ${jsonSql(r.permisos)}, ${arregloSql(r.automatizaciones)}, ${r.gestionaUsuarios}) on conflict (nombre) do nothing;`)
  }
  L.push("update public.roles set gestiona_usuarios = true, automatizaciones = '{*}' where nombre = 'admin';", '')

  L.push('-- ============ Perfiles: rol, equipo/sede y estado de cada usuario ============',
    'create table if not exists public.perfiles (',
    '  id uuid primary key references auth.users(id) on delete cascade,',
    '  nombre text,',
    "  rol text not null default 'usuario',",
    '  creado timestamptz not null default now()',
    ');',
    'alter table public.perfiles add column if not exists correo text;',
    'alter table public.perfiles add column if not exists activo boolean not null default true;',
    'alter table public.perfiles drop constraint if exists perfiles_rol_check;')
  for (const c of columnasPerfil) L.push(`alter table public.perfiles add column if not exists ${c} text;`)
  const rolPorDefecto = roles.find((r) => r.nombre === 'usuario') ? 'usuario' : roles[1]?.nombre || 'admin'
  L.push(`alter table public.perfiles alter column rol set default ${literal(rolPorDefecto)};`,
    `update public.perfiles set rol = ${literal(rolPorDefecto)} where rol not in (select nombre from public.roles);`,
    'alter table public.perfiles drop constraint if exists perfiles_rol_fkey;',
    'alter table public.perfiles add constraint perfiles_rol_fkey foreign key (rol) references public.roles(nombre) on update cascade;',
    'alter table public.perfiles enable row level security;',
    'alter table public.roles enable row level security;',
    '',
    '-- ============ Funciones de permisos (las usan las políticas y la app) ============',
    `create or replace function public.mi_rol() returns text ${definer} as $$ select rol from public.perfiles where id = auth.uid() and activo $$;`,
    `create or replace function public.es_admin() returns boolean ${definer} as $$ select coalesce(public.mi_rol() = 'admin', false) $$;`,
    `create or replace function public.gestiona_usuarios() returns boolean ${definer} as $$ select coalesce((select gestiona_usuarios from public.roles where nombre = public.mi_rol()), false) $$;`,
    `create or replace function public.permiso(tabla text) returns jsonb ${definer} as $$ select case when public.es_admin() then '{"acciones":["leer","crear","cambiar","borrar"],"alcance":"todo"}'::jsonb else (select permisos -> tabla from public.roles where nombre = public.mi_rol()) end $$;`,
    `create or replace function public.puede(tabla text, accion text) returns boolean ${definer} as $$ select coalesce(public.permiso(tabla) -> 'acciones' ? accion, false) $$;`,
    `create or replace function public.alcance(tabla text) returns text ${definer} as $$ select coalesce(public.permiso(tabla) ->> 'alcance', 'todo') $$;`,
    `create or replace function public.puede_automatizacion(id text) returns boolean ${definer} as $$ select public.es_admin() or coalesce((select '*' = any(automatizaciones) or id = any(automatizaciones) from public.roles where nombre = public.mi_rol()), false) $$;`)
  for (const c of columnasPerfil) L.push(`create or replace function public.mi_${c}() returns text ${definer} as $$ select ${c} from public.perfiles where id = auth.uid() $$;`)
  L.push(
    '-- quien gestiona usuarios no puede nombrar administradores (solo un admin) ni cambiarse su propio rol',
    `create or replace function public.cuidar_perfil() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- SQL Editor, servidor o funciones internas
  if new.rol is distinct from old.rol and new.id = auth.uid() then raise exception 'No puedes cambiar tu propio rol'; end if;
  if (new.rol = 'admin' or old.rol = 'admin') and new.rol is distinct from old.rol and not public.es_admin() then raise exception 'Solo un administrador puede dar o quitar el rol admin'; end if;
  return new;
end $$;`,
    'drop trigger if exists cuidar_perfil on public.perfiles;',
    'create trigger cuidar_perfil before update on public.perfiles for each row execute function public.cuidar_perfil();',
    'drop policy if exists "perfil propio o admin" on public.perfiles;',
    'drop policy if exists "admin gestiona perfiles" on public.perfiles;',
    'drop policy if exists "ver perfiles" on public.perfiles;',
    'drop policy if exists "gestionar perfiles" on public.perfiles;',
    'create policy "ver perfiles" on public.perfiles for select to authenticated using (id = auth.uid() or (select public.gestiona_usuarios()));',
    'create policy "gestionar perfiles" on public.perfiles for update to authenticated using ((select public.gestiona_usuarios())) with check ((select public.gestiona_usuarios()));',
    'drop policy if exists "ver roles" on public.roles;',
    'drop policy if exists "admin edita roles" on public.roles;',
    'create policy "ver roles" on public.roles for select to authenticated using (true);',
    'create policy "admin edita roles" on public.roles for all to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));',
    '-- cada usuario nuevo recibe su perfil (rol, nombre y sede pueden venir al crearlo desde la app)',
    `create or replace function public.crear_perfil() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre, correo, rol${columnasPerfil.map((c) => `, ${c}`).join('')})
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)), new.email,
    coalesce((select nombre from public.roles where nombre = new.raw_app_meta_data->>'rol'), ${literal(rolPorDefecto)})${columnasPerfil.map((c) => `, new.raw_app_meta_data->>'${c}'`).join('')})
  on conflict (id) do nothing;
  return new;
end $$;`,
    'drop trigger if exists crear_perfil on auth.users;',
    'create trigger crear_perfil after insert on auth.users for each row execute function public.crear_perfil();',
    "insert into public.perfiles (id, nombre, correo) select id, split_part(email, '@', 1), email from auth.users on conflict (id) do nothing;",
    'update public.perfiles p set correo = u.email from auth.users u where u.id = p.id and p.correo is null;',
    'create or replace function public.marcar_actualizado() returns trigger language plpgsql as $$ begin new.actualizado = now(); return new; end $$;',
    '',
    '-- ============ Sistema: versión mínima de la app, historial de migraciones, errores de los equipos y auditoría ============',
    'create table if not exists public.app_config (clave text primary key, valor text, actualizado timestamptz not null default now());',
    'alter table public.app_config enable row level security;',
    'drop policy if exists "ver config" on public.app_config;',
    'drop policy if exists "admin config" on public.app_config;',
    'create policy "ver config" on public.app_config for select to anon, authenticated using (true);',
    'create policy "admin config" on public.app_config for all to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));',
    "-- las apps de escritorio mandan su versión (x-app-version); por debajo de version_minima no pueden escribir",
    `create or replace function public.version_app_ok() returns boolean language plpgsql stable security definer set search_path = public as $$
declare minima text; actual text;
begin
  select valor into minima from public.app_config where clave = 'version_minima';
  if coalesce(minima, '') = '' then return true; end if;
  begin actual := nullif(current_setting('request.headers', true), '')::json ->> 'x-app-version'; exception when others then actual := null; end;
  if actual is null then return true; end if; -- la web y el SQL Editor no llevan versión
  return string_to_array(substring(actual from '^[0-9]+(?:\\.[0-9]+)*'), '.')::int[] >= string_to_array(substring(minima from '^[0-9]+(?:\\.[0-9]+)*'), '.')::int[];
end $$;`,
    'create table if not exists public.migraciones (nombre text primary key, resumen text, aplicada timestamptz not null default now());',
    'alter table public.migraciones enable row level security;',
    'drop policy if exists "ver migraciones" on public.migraciones;',
    'create policy "ver migraciones" on public.migraciones for select to authenticated using ((select public.gestiona_usuarios()));',
    'create table if not exists public.app_errores (',
    '  id bigint generated always as identity primary key,',
    '  equipo text, version text, origen text,',
    '  usuario uuid default auth.uid() references auth.users(id) on delete set null,',
    '  mensaje text not null, detalle text,',
    '  creado timestamptz not null default now()',
    ');',
    'create index if not exists app_errores_creado_idx on public.app_errores (creado desc);',
    'alter table public.app_errores enable row level security;',
    'drop policy if exists "reportar error" on public.app_errores;',
    'drop policy if exists "ver errores" on public.app_errores;',
    'create policy "reportar error" on public.app_errores for insert to authenticated with check (usuario = auth.uid());',
    'create policy "ver errores" on public.app_errores for select to authenticated using ((select public.gestiona_usuarios()));',
    "delete from public.app_errores where creado < now() - interval '90 days';",
    'create table if not exists public.auditoria (',
    '  id bigint generated always as identity primary key,',
    '  tabla text not null, fila uuid, accion text not null,',
    '  antes jsonb, despues jsonb,',
    '  usuario uuid default auth.uid(), equipo text,',
    '  cuando timestamptz not null default now()',
    ');',
    'create index if not exists auditoria_fila_idx on public.auditoria (tabla, fila);',
    'create index if not exists auditoria_cuando_idx on public.auditoria (cuando desc);',
    'alter table public.auditoria enable row level security;',
    'drop policy if exists "ver auditoria" on public.auditoria;',
    'create policy "ver auditoria" on public.auditoria for select to authenticated using ((select public.gestiona_usuarios()));',
    `create or replace function public.auditar() returns trigger language plpgsql security definer set search_path = public as $$
declare equipo text;
begin
  if TG_OP = 'UPDATE' and (to_jsonb(new) - 'actualizado') = (to_jsonb(old) - 'actualizado') then return new; end if;
  begin equipo := nullif(current_setting('request.headers', true), '')::json ->> 'x-equipo'; exception when others then equipo := null; end;
  insert into public.auditoria (tabla, fila, accion, antes, despues, usuario, equipo)
  values (TG_TABLE_NAME, case when TG_OP = 'DELETE' then old.id else new.id end, lower(TG_OP),
    case when TG_OP <> 'INSERT' then to_jsonb(old) end, case when TG_OP <> 'DELETE' then to_jsonb(new) end, auth.uid(), equipo);
  return coalesce(new, old);
end $$;`,
    '')

  for (const t of orden) {
    L.push(`-- ============ ${t.nombre}${t.columnaAcceso ? ` (alcance "sede" por ${t.columnaAcceso})` : ''} ============`)
    const defs = ['  id uuid primary key default gen_random_uuid()']
    for (const c of t.columnas) {
      let d = `  ${c.nombre} ${c.tipo}`
      if (c.requerido) d += ' not null'
      if (c.unico) d += ' unique'
      if (c.defecto !== undefined) d += ` default ${c.defecto === 'ahora' ? (c.tipo === 'date' ? 'current_date' : 'now()') : literal(c.defecto)}`
      if (c.referencia) d += ` references public.${c.referencia}(id) on delete ${c.requerido ? 'restrict' : 'set null'}`
      if (c.opciones) d += ` check (${c.nombre} in (${c.opciones.map(literal).join(', ')}))`
      if (c.tipoOriginal === 'correo') d += ` check (${c.nombre} ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')`
      defs.push(d)
    }
    defs.push('  creado_por uuid default auth.uid() references auth.users(id) on delete set null', '  creado timestamptz not null default now()', '  actualizado timestamptz not null default now()')
    L.push(`create table if not exists public.${t.nombre} (`, defs.join(',\n'), ');')
    for (const c of t.columnas) L.push(`alter table public.${t.nombre} add column if not exists ${c.nombre} ${c.tipo};`)
    for (const c of t.columnas.filter((x) => x.referencia)) L.push(`create index if not exists ${t.nombre}_${c.nombre}_idx on public.${t.nombre} (${c.nombre});`)
    if (t.columnaAcceso) L.push(`create index if not exists ${t.nombre}_${t.columnaAcceso}_idx on public.${t.nombre} (${t.columnaAcceso});`)
    L.push(`drop trigger if exists marcar_actualizado on public.${t.nombre};`,
      `create trigger marcar_actualizado before update on public.${t.nombre} for each row execute function public.marcar_actualizado();`,
      `drop trigger if exists auditar on public.${t.nombre};`,
      ...(t.auditar ? [`create trigger auditar after insert or update or delete on public.${t.nombre} for each row execute function public.auditar();`] : []),
      `alter table public.${t.nombre} enable row level security;`,
      `alter table public.${t.nombre} replica identity full; -- el tiempo real envía la fila completa también al borrar`)
    for (const viejo of ['con sesion', 'leer', 'crear', 'cambiar', 'borrar', 'admin escribe', 'rol leer', 'rol crear', 'rol cambiar', 'rol borrar']) L.push(`drop policy if exists "${viejo}" on public.${t.nombre};`)
    const T = literal(t.nombre)
    const dentro = `((select public.alcance(${T})) = 'todo'${t.columnaAcceso ? ` or ((select public.alcance(${T})) = 'sede' and ${t.columnaAcceso} = (select public.mi_${t.columnaAcceso}()))` : ''} or ((select public.alcance(${T})) = 'propio' and creado_por = auth.uid()))`
    const cond = (accion) => `(select public.puede(${T}, '${accion}')) and ${dentro}${accion === 'leer' ? '' : ' and (select public.version_app_ok())'}`
    L.push(`create policy "rol leer" on public.${t.nombre} for select to authenticated using (${cond('leer')});`,
      `create policy "rol crear" on public.${t.nombre} for insert to authenticated with check (${cond('crear')});`,
      `create policy "rol cambiar" on public.${t.nombre} for update to authenticated using (${cond('cambiar')}) with check (${cond('cambiar')});`,
      `create policy "rol borrar" on public.${t.nombre} for delete to authenticated using (${cond('borrar')});`,
      `do $$ begin alter publication supabase_realtime add table public.${t.nombre}; exception when duplicate_object then null; end $$;`, '')
  }

  L.push('-- ============ Automatizaciones: turnos (para que una tarea programada corra en un solo equipo) y corridas ============',
    'create table if not exists public.automatizacion_turnos (',
    '  clave text primary key,',
    '  equipo text,',
    '  usuario uuid default auth.uid(),',
    '  tomado timestamptz not null default now()',
    ');',
    'create table if not exists public.automatizacion_corridas (',
    '  id uuid primary key default gen_random_uuid(),',
    '  automatizacion text not null,',
    '  nombre text,',
    '  equipo text,',
    '  usuario uuid default auth.uid() references auth.users(id) on delete set null,',
    '  inicio timestamptz,',
    '  fin timestamptz not null default now(),',
    '  ok boolean not null,',
    '  disparo text,',
    '  error text,',
    '  resultado jsonb',
    ');',
    'create index if not exists automatizacion_corridas_fin_idx on public.automatizacion_corridas (fin desc);',
    'alter table public.automatizacion_turnos enable row level security;',
    'alter table public.automatizacion_corridas enable row level security;',
    'drop policy if exists "tomar turno" on public.automatizacion_turnos;',
    'drop policy if exists "ver turnos" on public.automatizacion_turnos;',
    "create policy \"tomar turno\" on public.automatizacion_turnos for insert to authenticated with check ((select public.puede_automatizacion(split_part(clave, '@', 1))));",
    'create policy "ver turnos" on public.automatizacion_turnos for select to authenticated using (true);',
    'drop policy if exists "anotar corrida" on public.automatizacion_corridas;',
    'drop policy if exists "ver corridas" on public.automatizacion_corridas;',
    'create policy "anotar corrida" on public.automatizacion_corridas for insert to authenticated with check (usuario = auth.uid());',
    'create policy "ver corridas" on public.automatizacion_corridas for select to authenticated using (usuario = auth.uid() or (select public.gestiona_usuarios()));',
    "delete from public.automatizacion_turnos where tomado < now() - interval '30 days';",
    'do $$ begin alter publication supabase_realtime add table public.automatizacion_corridas; exception when duplicate_object then null; end $$;',
    '',
    '-- Primer administrador: cambia el correo y córrelo después de crear tu usuario en Authentication → Users.',
    "-- update public.perfiles set rol = 'admin' where correo = 'admin@tuempresa.com';",
    '-- Después, los demás usuarios se crean desde la app (Usuarios y roles).')
  return { sql: L.join('\n') + '\n', tablas: orden.map((t) => t.nombre), columnasPerfil, roles: roles.map((r) => r.nombre) }
}


const existeColumna = (tabla, col) => `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = ${literal(tabla)} and column_name = ${literal(col)})`
const existeTabla = (tabla) => `exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = ${literal(tabla)})`

/**
 * Cambios que no se pueden expresar como "estado deseado" (renombrar, quitar, cambiar tipo). Cada uno es
 * idempotente y, antes de borrar algo, deja una copia en una tabla respaldo_*.
 * cambios: [{ tipo: 'renombrar-columna', tabla, de, a } · { tipo: 'renombrar-tabla', de, a } · { tipo: 'cambiar-tipo', tabla, columna, nuevoTipo }
 *           · { tipo: 'quitar-columna', tabla, columna, confirmar: true } · { tipo: 'quitar-tabla', tabla, confirmar: true } · { tipo: 'sql', descripcion, sql }]
 */
export function sqlDeCambios(cambios, { fecha = new Date() } = {}) {
  if (!Array.isArray(cambios) || !cambios.length) throw new Error('"cambios" debe ser una lista')
  const sello = fecha.toISOString().slice(0, 10).replace(/-/g, '')
  const L = [], resumen = []
  for (const c of cambios) {
    if (c.tipo === 'renombrar-columna') {
      const tabla = nombreSql(c.tabla, 'La tabla'), de = nombreSql(c.de, 'La columna'), a = nombreSql(c.a, 'La columna nueva')
      L.push(`do $$ begin if ${existeColumna(tabla, de)} and not ${existeColumna(tabla, a)} then execute 'alter table public.${tabla} rename column ${de} to ${a}'; end if; end $$;`)
      resumen.push(`${tabla}: ${de} → ${a}`)
    } else if (c.tipo === 'renombrar-tabla') {
      const de = nombreSql(c.de, 'La tabla'), a = nombreSql(c.a, 'La tabla nueva')
      if (PROPIAS.has(de) || PROPIAS.has(a)) throw new Error(`"${PROPIAS.has(de) ? de : a}" es del plugin y no se renombra`)
      L.push(`do $$ begin if ${existeTabla(de)} and not ${existeTabla(a)} then execute 'alter table public.${de} rename to ${a}'; end if; end $$;`,
        `update public.roles set permisos = (permisos - ${literal(de)}) || jsonb_build_object(${literal(a)}, permisos -> ${literal(de)}) where permisos ? ${literal(de)};`)
      resumen.push(`tabla ${de} → ${a}`)
    } else if (c.tipo === 'cambiar-tipo') {
      const tabla = nombreSql(c.tabla, 'La tabla'), col = nombreSql(c.columna, 'La columna')
      const tipo = TIPOS[c.nuevoTipo]
      if (!tipo) throw new Error(`cambiar-tipo: "${c.nuevoTipo}" no existe (usa ${Object.keys(TIPOS).join(', ')})`)
      L.push(`do $$ begin if ${existeColumna(tabla, col)} then execute 'alter table public.${tabla} alter column ${col} type ${tipo} using ${col}::${tipo}'; end if; end $$;`)
      resumen.push(`${tabla}.${col} ahora es ${c.nuevoTipo}`)
    } else if (c.tipo === 'quitar-columna') {
      const tabla = nombreSql(c.tabla, 'La tabla'), col = nombreSql(c.columna, 'La columna')
      if (c.confirmar !== true) throw new Error(`quitar ${tabla}.${col} borra datos: pásalo con "confirmar": true después de que el usuario lo apruebe`)
      const resp = `respaldo_${tabla}_${col}_${sello}`.slice(0, 60)
      L.push(`do $$ begin if ${existeColumna(tabla, col)} then execute 'create table if not exists public.${resp} as select id, ${col} from public.${tabla}'; execute 'alter table public.${resp} enable row level security'; execute 'alter table public.${tabla} drop column ${col}'; end if; end $$;`)
      resumen.push(`quitada ${tabla}.${col} (copia en ${resp})`)
    } else if (c.tipo === 'quitar-tabla') {
      const tabla = nombreSql(c.tabla, 'La tabla')
      if (PROPIAS.has(tabla)) throw new Error(`"${tabla}" es del plugin y no se quita`)
      if (c.confirmar !== true) throw new Error(`quitar la tabla ${tabla} borra datos: pásalo con "confirmar": true después de que el usuario lo apruebe`)
      const resp = `respaldo_${tabla}_${sello}`.slice(0, 60)
      L.push(`do $$ begin if ${existeTabla(tabla)} and not ${existeTabla(resp)} then begin execute 'alter publication supabase_realtime drop table public.${tabla}'; exception when others then null; end; execute 'alter table public.${tabla} rename to ${resp}'; end if; end $$;`,
        `update public.roles set permisos = permisos - ${literal(tabla)} where permisos ? ${literal(tabla)};`)
      resumen.push(`quitada la tabla ${tabla} (queda como ${resp})`)
    } else if (c.tipo === 'sql') {
      if (!String(c.sql || '').trim()) throw new Error('cambio sql vacío')
      L.push(`-- ${String(c.descripcion || 'cambio manual').replace(/\n/g, ' ')}`, String(c.sql).trim().replace(/;?\s*$/, ';'))
      resumen.push(c.descripcion || 'cambio manual')
    } else throw new Error(`tipo de cambio desconocido: ${c.tipo}`)
  }
  return { sql: L.join('\n') + '\n', resumen: resumen.join('; ') }
}

/** Envuelve una migración para que solo se aplique una vez y quede registrada en public.migraciones. */
export function envolverMigracion(nombre, sql, resumen = '') {
  const n = String(nombre).replace(/[^a-z0-9_-]/gi, '_')
  const etiqueta = `m_${n.replace(/-/g, '_')}`.slice(0, 40)
  if (sql.includes(`$${etiqueta}$`) || sql.includes(`$s_${etiqueta}$`)) throw new Error('la migración contiene su propia etiqueta')
  return [
    `-- Migración ${n}${resumen ? `: ${resumen}` : ''}`,
    'create table if not exists public.migraciones (nombre text primary key, resumen text, aplicada timestamptz not null default now());',
    `do $${etiqueta}$`,
    'begin',
    `  if exists (select 1 from public.migraciones where nombre = ${literal(n)}) then raise notice 'migración ${n} ya aplicada'; return; end if;`,
    `  execute $s_${etiqueta}$`,
    sql,
    `  $s_${etiqueta}$;`,
    `  insert into public.migraciones (nombre, resumen) values (${literal(n)}, ${literal(resumen)});`,
    `end $${etiqueta}$;`,
    '',
  ].join('\n')
}
