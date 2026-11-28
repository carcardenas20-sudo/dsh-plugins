// Supabase del lado servidor simulado: auth.admin + tablas perfiles/roles en memoria
export const bd = { perfiles: [], roles: [{ nombre: 'admin', gestiona_usuarios: true }, { nombre: 'cajero', gestiona_usuarios: false }, { nombre: 'gerente', gestiona_usuarios: true }], usuarios: [], tokens: {}, baneos: {} }
export function createClient() {
  const tabla = (t) => {
    let filtro = null
    const q = {
      select() { return q }, order() { return q }, eq(k, v) { filtro = [k, v]; return q },
      maybeSingle: async () => ({ data: bd[t].find((f) => f[filtro[0]] === filtro[1]) ?? null }),
      then(ok) { return Promise.resolve({ data: bd[t] }).then(ok) },
      upsert: async (f) => { const i = bd[t].findIndex((x) => x.id === f.id); i >= 0 ? (bd[t][i] = { ...bd[t][i], ...f }) : bd[t].push(f); return {} },
      update(c) { return { eq: async (k, v) => { bd[t].filter((x) => x[k] === v).forEach((x) => Object.assign(x, c)); return {} } } },
    }
    return q
  }
  return {
    from: tabla,
    auth: {
      getUser: async (tok) => (bd.tokens[tok] ? { data: { user: { id: bd.tokens[tok] } } } : { error: { message: 'bad jwt' }, data: {} }),
      admin: {
        listUsers: async () => ({ data: { users: bd.usuarios } }),
        createUser: async ({ email, app_metadata, user_metadata }) => {
          if (bd.usuarios.some((u) => u.email === email)) return { error: { message: 'A user with this email address has already been registered' } }
          const u = { id: 'id-' + (bd.usuarios.length + 1), email, app_metadata, user_metadata }; bd.usuarios.push(u)
          bd.perfiles.push({ id: u.id, nombre: user_metadata.nombre, rol: app_metadata.rol, activo: true, sede: app_metadata.sede ?? null }) // lo que haría el trigger
          return { data: { user: u } }
        },
        updateUserById: async (id, c) => { if (c.ban_duration) bd.baneos[id] = c.ban_duration; return {} },
        deleteUser: async (id) => { bd.usuarios = bd.usuarios.filter((u) => u.id !== id); bd.perfiles = bd.perfiles.filter((p) => p.id !== id); return {} },
      },
    },
  }
}
