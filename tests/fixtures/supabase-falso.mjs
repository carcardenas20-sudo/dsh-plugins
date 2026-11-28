export const estado = { filas: { pagos: [{ id: 1, sede: 'Norte', valor: 10 }, { id: 2, sede: 'Sur', valor: 5 }] }, red: true, canales: [], escrituras: [], insertados: {} }
const errRed = { message: 'TypeError: Failed to fetch' }
export function createClient() {
  const authOy = []
  return {
    from(t) {
      const filtros = []
      const q = {
        select() { return q }, eq(k, v) { filtros.push([k, v]); return q }, order() { return q }, limit() { return q }, maybeSingle() { if (t === 'pagos') return Promise.resolve({ data: estado.filas.pagos.find((f) => filtros.every(([k, v]) => f[k] === v)) ?? null }); return Promise.resolve({ data: t === 'roles' ? { nombre: 'cajero', permisos: { pagos: { acciones: ['leer', 'crear'], alcance: 'sede' } }, automatizaciones: ['descargar-pagos'], gestiona_usuarios: false } : { id: 'u1', nombre: 'Laura', rol: 'cajero', sede: 'Norte' } }) },
        then(ok) { return Promise.resolve(estado.red ? { data: estado.filas[t].filter((f) => filtros.every(([k, v]) => f[k] === v)) } : { error: errRed }).then(ok) },
        upsert(fila) { return { select: () => (estado.red ? (estado.escrituras.push(['upsert', t, fila]), Promise.resolve({ data: [fila] })) : Promise.reject(new TypeError('Failed to fetch'))) } },
        delete() { return { eq: (k, v) => (estado.red ? (estado.escrituras.push(['delete', t, v]), Promise.resolve({})) : Promise.resolve({ error: errRed })) } },
        insert(filas) { if (!estado.red) return Promise.reject(new TypeError('Failed to fetch')); (estado.insertados[t] ||= []).push(...(Array.isArray(filas) ? filas : [filas])); return Promise.resolve({}) },
        update(cambio) {
          const conds = []
          const u = { eq(k, v) { conds.push([k, v]); return u }, select() {
            if (!estado.red) return Promise.reject(new TypeError('Failed to fetch'))
            const f = (estado.filas[t] || []).filter((x) => conds.every(([k, v]) => x[k] === v))
            f.forEach((x) => Object.assign(x, cambio, { actualizado: new Date(Date.now() + 1000).toISOString() }))
            estado.escrituras.push(['update', t, cambio]); return Promise.resolve({ data: f })
          } }
          return u
        },
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
