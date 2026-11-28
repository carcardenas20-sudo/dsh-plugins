// Genera el SQL de Supabase para las tablas de una app: columnas, permisos por fila (RLS), perfiles con rol
// y sede, fecha de actualización automática y tiempo real. Todo es repetible: correrlo dos veces no rompe nada.

const TIPOS = {
  texto: 'text', numero: 'numeric', entero: 'integer', dinero: 'numeric(14,2)', fecha: 'date', fechahora: 'timestamptz',
  booleano: 'boolean', 'si-no': 'boolean', json: 'jsonb', uuid: 'uuid', correo: 'text', telefono: 'text',
}
const RESERVADAS = new Set(['user', 'order', 'group', 'table', 'select', 'from', 'where', 'limit', 'offset', 'default', 'check', 'primary', 'references', 'all', 'and', 'or', 'not', 'null', 'true', 'false', 'end', 'case', 'when', 'to', 'grant', 'column'])
const AUTOMATICAS = new Set(['id', 'creado_por', 'creado', 'actualizado'])
export const ACCESOS = ['autenticados', 'propietario', 'por-columna', 'solo-lectura']

const nombreSql = (s, que) => {
  const n = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!/^[a-z][a-z0-9_]{0,50}$/.test(n)) throw new Error(`${que} "${s}" no es un nombre válido (letras, números y _)`)
  if (RESERVADAS.has(n)) throw new Error(`${que} "${n}" es una palabra reservada de SQL; usa otro nombre`)
  return n
}
const literal = (v) => (v === null ? 'null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

/**
 * tablas: [{ nombre, columnas: [{ nombre, tipo, requerido, unico, defecto, referencia, opciones }], acceso, columnaAcceso }]
 * acceso: autenticados (cualquiera con sesión) · propietario (cada quien lo suyo; admin todo) ·
 *         por-columna (filas de su sede/área según su perfil; admin todo) · solo-lectura (todos leen, admin escribe)
 */
export function normalizarTablas(tablas) {
  if (!Array.isArray(tablas) || !tablas.length) throw new Error('"tablas" debe ser una lista con al menos una tabla')
  const nombres = new Set()
  const salida = tablas.map((t) => {
    const nombre = nombreSql(t.nombre, 'La tabla')
    if (nombre === 'perfiles') throw new Error('"perfiles" la crea el plugin (usuarios, rol y sede); usa otro nombre')
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
    if (acceso === 'por-columna') {
      columnaAcceso = nombreSql(t.columnaAcceso || 'sede', `La columna de acceso de ${nombre}`)
      if (!cols.has(columnaAcceso)) throw new Error(`${nombre}: acceso por-columna usa "${columnaAcceso}", que no está entre sus columnas`)
    }
    return { nombre, acceso, columnaAcceso, columnas }
  })
  for (const t of salida) for (const c of t.columnas) if (c.referencia && !nombres.has(c.referencia)) throw new Error(`${t.nombre}.${c.nombre} apunta a "${c.referencia}", que no está en esta lista de tablas`)
  return salida
}

export function sqlDeTablas(tablasEntrada) {
  const tablas = normalizarTablas(tablasEntrada)
  const columnasPerfil = [...new Set(tablas.filter((t) => t.columnaAcceso).map((t) => t.columnaAcceso))]
  // las tablas referenciadas primero
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

  const L = []
  L.push('-- Generado por dsh-escritorio. Pégalo en Supabase → SQL Editor → Run (se puede correr varias veces).', '')
  L.push('-- ============ Perfiles: rol (admin/usuario) y datos de acceso de cada usuario ============')
  L.push(`create table if not exists public.perfiles (`,
    `  id uuid primary key references auth.users(id) on delete cascade,`,
    `  nombre text,`,
    `  rol text not null default 'usuario' check (rol in ('admin', 'usuario')),`,
    `  creado timestamptz not null default now()`,
    `);`)
  for (const c of columnasPerfil) L.push(`alter table public.perfiles add column if not exists ${c} text;`)
  L.push('alter table public.perfiles enable row level security;',
    `create or replace function public.es_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin') $$;`)
  for (const c of columnasPerfil) L.push(`create or replace function public.mi_${c}() returns text language sql stable security definer set search_path = public as $$ select ${c} from public.perfiles where id = auth.uid() $$;`)
  L.push(`drop policy if exists "perfil propio o admin" on public.perfiles;`,
    `create policy "perfil propio o admin" on public.perfiles for select to authenticated using (id = auth.uid() or public.es_admin());`,
    `drop policy if exists "admin gestiona perfiles" on public.perfiles;`,
    `create policy "admin gestiona perfiles" on public.perfiles for all to authenticated using (public.es_admin()) with check (public.es_admin());`,
    `-- cada usuario nuevo recibe su perfil (el admin luego le asigna rol${columnasPerfil.length ? ` y ${columnasPerfil.join(', ')}` : ''})`,
    `create or replace function public.crear_perfil() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.perfiles (id, nombre) values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1))) on conflict (id) do nothing; return new; end $$;`,
    `drop trigger if exists crear_perfil on auth.users;`,
    `create trigger crear_perfil after insert on auth.users for each row execute function public.crear_perfil();`,
    `insert into public.perfiles (id, nombre) select id, split_part(email, '@', 1) from auth.users on conflict (id) do nothing;`,
    `create or replace function public.marcar_actualizado() returns trigger language plpgsql as $$ begin new.actualizado = now(); return new; end $$;`, '')

  for (const t of orden) {
    L.push(`-- ============ ${t.nombre} (acceso: ${t.acceso}${t.columnaAcceso ? ` por ${t.columnaAcceso}` : ''}) ============`)
    const defs = [`  id uuid primary key default gen_random_uuid()`]
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
    defs.push(`  creado_por uuid default auth.uid() references auth.users(id) on delete set null`, `  creado timestamptz not null default now()`, `  actualizado timestamptz not null default now()`)
    L.push(`create table if not exists public.${t.nombre} (`, defs.join(',\n'), ');')
    // si la tabla ya existía, agrega las columnas que falten
    for (const c of t.columnas) L.push(`alter table public.${t.nombre} add column if not exists ${c.nombre} ${c.tipo};`)
    for (const c of t.columnas.filter((x) => x.referencia)) L.push(`create index if not exists ${t.nombre}_${c.nombre}_idx on public.${t.nombre} (${c.nombre});`)
    if (t.columnaAcceso) L.push(`create index if not exists ${t.nombre}_${t.columnaAcceso}_idx on public.${t.nombre} (${t.columnaAcceso});`)
    L.push(`drop trigger if exists marcar_actualizado on public.${t.nombre};`,
      `create trigger marcar_actualizado before update on public.${t.nombre} for each row execute function public.marcar_actualizado();`,
      `alter table public.${t.nombre} enable row level security;`,
      `alter table public.${t.nombre} replica identity full; -- el tiempo real envía la fila completa también al borrar`)
    const pol = (nombre, para, usando, chequeo) => {
      L.push(`drop policy if exists "${nombre}" on public.${t.nombre};`)
      L.push(`create policy "${nombre}" on public.${t.nombre} for ${para} to authenticated${usando ? ` using (${usando})` : ''}${chequeo ? ` with check (${chequeo})` : ''};`)
    }
    // quita las políticas de un acceso anterior: si se cambia de 'autenticados' a 'propietario', no debe quedar abierta
    for (const viejo of ['con sesion', 'leer', 'crear', 'cambiar', 'borrar', 'admin escribe']) L.push(`drop policy if exists "${viejo}" on public.${t.nombre};`)
    if (t.acceso === 'autenticados') pol('con sesion', 'all', 'true', 'true')
    else if (t.acceso === 'propietario') {
      pol('leer', 'select', 'creado_por = auth.uid() or public.es_admin()')
      pol('crear', 'insert', null, 'creado_por = auth.uid() or public.es_admin()')
      pol('cambiar', 'update', 'creado_por = auth.uid() or public.es_admin()', 'creado_por = auth.uid() or public.es_admin()')
      pol('borrar', 'delete', 'creado_por = auth.uid() or public.es_admin()')
    } else if (t.acceso === 'por-columna') {
      const cond = `${t.columnaAcceso} = public.mi_${t.columnaAcceso}() or public.es_admin()`
      pol('leer', 'select', cond)
      pol('crear', 'insert', null, cond)
      pol('cambiar', 'update', cond, cond)
      pol('borrar', 'delete', cond)
    } else {
      pol('leer', 'select', 'true')
      pol('admin escribe', 'all', 'public.es_admin()', 'public.es_admin()')
    }
    L.push(`do $$ begin alter publication supabase_realtime add table public.${t.nombre}; exception when duplicate_object then null; end $$;`, '')
  }
  L.push('-- Primer administrador: cambia el correo y córrelo después de crear el usuario en Authentication → Users.',
    `-- update public.perfiles set rol = 'admin' where id = (select id from auth.users where email = 'admin@tuempresa.com');`)
  for (const c of columnasPerfil) L.push(`-- update public.perfiles set ${c} = 'Norte' where id = (select id from auth.users where email = 'equipo1@tuempresa.com');`)
  return { sql: L.join('\n') + '\n', tablas: orden.map((t) => t.nombre), columnasPerfil }
}
