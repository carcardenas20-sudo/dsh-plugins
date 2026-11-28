// Función del servidor (Supabase Edge Function "gestionar-usuarios"), generada por dsh-escritorio.
// Crea y administra usuarios desde la app sin poner la clave secreta dentro del instalador: la clave
// service_role solo existe aquí, en el servidor de Supabase. Solo responde a quien tenga un rol que
// gestiona usuarios; nombrar o tocar administradores queda solo para administradores.
//
// Publicar: Supabase → Edge Functions → Deploy a new function → nombre "gestionar-usuarios" → pega este archivo.
//           (o con la CLI: supabase functions deploy gestionar-usuarios)
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const responder = (estado: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } })
const CAMPOS_PROPIOS = new Set(['id', 'nombre', 'rol', 'correo', 'activo', 'creado'])
const correoValido = (c: unknown) => typeof c === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.trim())

type Entorno = { url: string; servicio: string; anon: string; crear?: typeof createClient }

export async function manejar(req: Request, entorno: Entorno): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return responder(405, { error: 'Usa POST' })
  const crear = entorno.crear ?? createClient
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return responder(401, { error: 'Inicia sesión primero' })
  const servidor = crear(entorno.url, entorno.servicio, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: quien, error: errQuien } = await servidor.auth.getUser(token)
  if (errQuien || !quien?.user) return responder(401, { error: 'Sesión vencida: vuelve a iniciar sesión' })
  const yo = quien.user.id
  const { data: miPerfil } = await servidor.from('perfiles').select('rol, activo').eq('id', yo).maybeSingle()
  if (!miPerfil?.activo) return responder(403, { error: 'Tu usuario está desactivado' })
  const { data: miRol } = await servidor.from('roles').select('gestiona_usuarios').eq('nombre', miPerfil.rol).maybeSingle()
  const soyAdmin = miPerfil.rol === 'admin'
  if (!soyAdmin && !miRol?.gestiona_usuarios) return responder(403, { error: 'Tu rol no puede administrar usuarios' })

  let cuerpo: Record<string, any>
  try { cuerpo = await req.json() } catch { return responder(400, { error: 'Cuerpo inválido' }) }
  const { accion } = cuerpo
  const perfilDe = async (id: string) => (await servidor.from('perfiles').select('*').eq('id', id).maybeSingle()).data
  const rolExiste = async (rol: string) => !!(await servidor.from('roles').select('nombre').eq('nombre', rol).maybeSingle()).data
  const camposExtra = (c: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(c).filter(([k, v]) => !CAMPOS_PROPIOS.has(k) && /^[a-z][a-z0-9_]{0,50}$/.test(k) && (v === null || typeof v === 'string')))

  try {
    if (accion === 'listar') {
      const { data: perfiles, error } = await servidor.from('perfiles').select('*').order('nombre')
      if (error) throw error
      const usuarios: Record<string, any> = {}
      for (let pagina = 1; pagina <= 10; pagina++) {
        const { data } = await servidor.auth.admin.listUsers({ page: pagina, perPage: 1000 })
        for (const u of data?.users ?? []) usuarios[u.id] = u
        if ((data?.users?.length ?? 0) < 1000) break
      }
      return responder(200, { usuarios: (perfiles ?? []).map((p: any) => ({ ...p, correo: p.correo ?? usuarios[p.id]?.email ?? null, ultimoIngreso: usuarios[p.id]?.last_sign_in_at ?? null, soyYo: p.id === yo })) })
    }

    if (accion === 'crear') {
      const { correo, clave, nombre, rol } = cuerpo
      if (!correoValido(correo)) return responder(400, { error: 'Correo inválido' })
      if (typeof clave !== 'string' || clave.length < 8) return responder(400, { error: 'La clave debe tener al menos 8 caracteres' })
      if (!rol || !(await rolExiste(rol))) return responder(400, { error: `El rol "${rol}" no existe` })
      if (rol === 'admin' && !soyAdmin) return responder(403, { error: 'Solo un administrador puede crear administradores' })
      const extra = camposExtra(cuerpo.campos)
      const { data, error } = await servidor.auth.admin.createUser({ email: correo.trim().toLowerCase(), password: clave, email_confirm: true, user_metadata: { nombre: nombre || undefined }, app_metadata: { rol, ...extra } })
      if (error) return responder(400, { error: /already|registered|exists/i.test(error.message) ? 'Ya existe un usuario con ese correo' : error.message })
      // por si el perfil ya existía o el trigger no tomó los datos
      await servidor.from('perfiles').upsert({ id: data.user.id, nombre: nombre || correo.split('@')[0], correo: correo.trim().toLowerCase(), rol, activo: true, ...extra })
      return responder(200, { ok: true, id: data.user.id })
    }

    const { id } = cuerpo
    if (typeof id !== 'string') return responder(400, { error: 'Falta el usuario' })
    const destino = await perfilDe(id)
    if (!destino) return responder(404, { error: 'Ese usuario no existe' })
    if (destino.rol === 'admin' && !soyAdmin) return responder(403, { error: 'Solo un administrador puede modificar a otro administrador' })

    if (accion === 'actualizar') {
      const cambios: Record<string, unknown> = { ...camposExtra(cuerpo.campos) }
      if (typeof cuerpo.nombre === 'string') cambios.nombre = cuerpo.nombre.trim()
      if (cuerpo.rol !== undefined && cuerpo.rol !== destino.rol) {
        if (id === yo) return responder(403, { error: 'No puedes cambiar tu propio rol' })
        if (!(await rolExiste(cuerpo.rol))) return responder(400, { error: `El rol "${cuerpo.rol}" no existe` })
        if (cuerpo.rol === 'admin' && !soyAdmin) return responder(403, { error: 'Solo un administrador puede nombrar administradores' })
        cambios.rol = cuerpo.rol
      }
      if (typeof cuerpo.activo === 'boolean' && cuerpo.activo !== destino.activo) {
        if (id === yo) return responder(403, { error: 'No puedes desactivarte a ti mismo' })
        cambios.activo = cuerpo.activo
        // desactivar también bloquea el inicio de sesión
        const { error } = await servidor.auth.admin.updateUserById(id, { ban_duration: cuerpo.activo ? 'none' : '876000h' })
        if (error) throw error
      }
      if (Object.keys(cambios).length) {
        const { error } = await servidor.from('perfiles').update(cambios).eq('id', id)
        if (error) throw error
        if (cambios.rol || Object.keys(camposExtra(cuerpo.campos)).length) await servidor.auth.admin.updateUserById(id, { app_metadata: { rol: cambios.rol ?? destino.rol, ...camposExtra(cuerpo.campos) } })
      }
      return responder(200, { ok: true })
    }

    if (accion === 'clave') {
      if (typeof cuerpo.clave !== 'string' || cuerpo.clave.length < 8) return responder(400, { error: 'La clave debe tener al menos 8 caracteres' })
      const { error } = await servidor.auth.admin.updateUserById(id, { password: cuerpo.clave })
      if (error) throw error
      return responder(200, { ok: true })
    }

    if (accion === 'borrar') {
      if (!soyAdmin) return responder(403, { error: 'Solo un administrador puede borrar usuarios' })
      if (id === yo) return responder(403, { error: 'No puedes borrarte a ti mismo' })
      const { error } = await servidor.auth.admin.deleteUser(id)
      if (error) throw error
      return responder(200, { ok: true })
    }

    return responder(400, { error: `Acción desconocida: ${accion}` })
  } catch (e) {
    return responder(500, { error: String((e as Error)?.message || e) })
  }
}

// En Supabase corre con Deno; las variables las pone Supabase solo.
if (typeof (globalThis as any).Deno !== 'undefined') {
  const env = (globalThis as any).Deno.env
  ;(globalThis as any).Deno.serve((req: Request) => manejar(req, { url: env.get('SUPABASE_URL'), servicio: env.get('SUPABASE_SERVICE_ROLE_KEY'), anon: env.get('SUPABASE_ANON_KEY') }))
}
