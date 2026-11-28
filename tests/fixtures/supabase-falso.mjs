export const estado = { filas: { pagos: [{ id: 1, sede: 'Norte', valor: 10 }, { id: 2, sede: 'Sur', valor: 5 }] }, red: true, canales: [], escrituras: [] }
const errRed = { message: 'TypeError: Failed to fetch' }
export function createClient() {
  const authOy = []
  return {
    from(t) {
      const filtros = []
      const q = {
        select() { return q }, eq(k, v) { filtros.push([k, v]); return q }, order() { return q }, limit() { return q }, maybeSingle() { return Promise.resolve({ data: { id: 'u1', nombre: 'Laura', rol: 'usuario', sede: 'Norte' } }) },
        then(ok) { return Promise.resolve(estado.red ? { data: estado.filas[t].filter((f) => filtros.every(([k, v]) => f[k] === v)) } : { error: errRed }).then(ok) },
        upsert(fila) { return { select: () => (estado.red ? (estado.escrituras.push(['upsert', t, fila]), Promise.resolve({ data: [fila] })) : Promise.reject(new TypeError('Failed to fetch'))) } },
        delete() { return { eq: (k, v) => (estado.red ? (estado.escrituras.push(['delete', t, v]), Promise.resolve({})) : Promise.resolve({ error: errRed })) } },
      }
      return q
    },
    channel(nombre) { const c = { nombre, on(_t, f, cb) { c.f = f; c.cb = cb; return c }, subscribe(cb) { c.sub = cb; estado.canales.push(c); setTimeout(() => cb('SUBSCRIBED'), 5); return c } }; return c },
    removeChannel(c) { estado.canales = estado.canales.filter((x) => x !== c) },
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange(fn) { authOy.push(fn) },
      async signInWithPassword({ email, password }) { if (password !== 'bien123') return { error: { message: 'Invalid login credentials' } }; const s = { user: { id: 'u1', email } }; authOy.forEach((f) => f('SIGNED_IN', s)); return { data: s } },
      async signOut() { authOy.forEach((f) => f('SIGNED_OUT', null)) },
    },
  }
}
