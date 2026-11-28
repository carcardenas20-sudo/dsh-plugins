// Datos en vivo con Supabase (generado por dsh-escritorio). Sirve igual en la web y en la app de escritorio.
//
//   import { crearDatos } from './lib/datos-en-vivo.js'
//   const datos = crearDatos({ url: 'https://abcd.supabase.co', clave: 'sb_publishable_…' })
//   const parar = datos.enVivo('pagos', { filtro: { sede: 'Norte' }, orden: 'creado' }, (filas, info) => pintar(filas))
//   await datos.guardar('pagos', { documento: '1023', saldo: 50000 })   // sin internet: queda en cola y se envía al volver
//
// Sesión y conexión (la pantalla lista está en escritorio-ui.js):
//   await datos.sesion.entrar('correo@x.co', 'clave') · datos.sesion.salir() · datos.sesion.alCambiar((usuario, perfil) => …)
//   datos.alCambiarConexion(({ estado: 'en-linea' | 'sin-conexion' | 'reconectando', pendientes }) => …)
//
// En React:
//   useEffect(() => datos.enVivo('pagos', {}, (filas) => setPagos(filas)), [])
//
// Seguridad: la clave es la PÚBLICA (anon/publishable). Lo que cada usuario puede ver o cambiar lo deciden las
// políticas de Row Level Security en Supabase, no este archivo.
import { createClient } from '@supabase/supabase-js'

const disponible = typeof window !== 'undefined'
const almacen = {
  leer(k, porDefecto) { try { const v = disponible && localStorage.getItem(k); return v ? JSON.parse(v) : porDefecto } catch { return porDefecto } },
  guardar(k, v) { try { if (disponible) localStorage.setItem(k, JSON.stringify(v)) } catch {} },
}
const esErrorDeRed = (e) => !e?.code && /fetch|network|Failed to fetch|NetworkError|ERR_INTERNET|timed? ?out/i.test(String(e?.message || e))

export function crearDatos({ url, clave, opciones = {} }) {
  const cliente = createClient(url, clave, opciones)
  const prefijo = `datos:${new URL(url).host}:`
  const oyentesCola = new Set()

  // En la app de escritorio, las automatizaciones actúan con la sesión del usuario que inició sesión aquí.
  if (disponible && window.escritorio?.automatizaciones) {
    cliente.auth.getSession().then(({ data }) => window.escritorio.automatizaciones.sesion(data.session))
    cliente.auth.onAuthStateChange((_evento, sesion) => window.escritorio.automatizaciones.sesion(sesion))
  }

  /**
   * Lee una tabla y la mantiene al día con cada cambio (de este u otros dispositivos).
   * alCambiar(filas, { origen: 'copia-local' | 'servidor' | 'tiempo-real', cambio?, error? })
   * opciones: { seleccion = '*', filtro = { columna: valor }, orden = 'columna' | { columna, asc }, limite, id = 'id' }
   * Devuelve una función para dejar de escuchar.
   */
  function enVivo(tabla, op = {}, alCambiar = () => {}) {
    const id = op.id || 'id'
    const filtro = op.filtro || {}
    const llave = `${prefijo}${tabla}:${JSON.stringify(filtro)}`
    let filas = almacen.leer(llave, [])
    let vivo = true
    const avisar = (info) => { if (vivo) alCambiar(filas, info) }
    const guardarCopia = () => almacen.guardar(llave, filas)
    if (filas.length) avisar({ origen: 'copia-local' })

    const cumple = (fila) => Object.entries(filtro).every(([k, v]) => fila?.[k] === v)
    const ordenar = () => {
      if (!op.orden) return
      const { columna, asc = true } = typeof op.orden === 'string' ? { columna: op.orden } : op.orden
      filas.sort((a, b) => (a[columna] > b[columna] ? 1 : a[columna] < b[columna] ? -1 : 0) * (asc ? 1 : -1))
    }

    async function cargar() {
      let q = cliente.from(tabla).select(op.seleccion || '*')
      for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v)
      if (op.orden) { const { columna, asc = true } = typeof op.orden === 'string' ? { columna: op.orden } : op.orden; q = q.order(columna, { ascending: asc }) }
      if (op.limite) q = q.limit(op.limite)
      const { data, error } = await q
      if (error) return avisar({ origen: 'copia-local', error })
      filas = data; guardarCopia(); avisar({ origen: 'servidor' })
    }

    // Supabase solo filtra en tiempo real por una columna; el resto se filtra aquí.
    const [primera] = Object.entries(filtro)
    const canal = cliente
      .channel(`vivo:${tabla}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: op.esquema || 'public', table: tabla, ...(primera ? { filter: `${primera[0]}=eq.${primera[1]}` } : {}) }, (c) => {
        if (c.eventType === 'DELETE') filas = filas.filter((f) => f[id] !== c.old[id])
        else if (!cumple(c.new)) filas = filas.filter((f) => f[id] !== c.new[id])
        else if (filas.some((f) => f[id] === c.new[id])) filas = filas.map((f) => (f[id] === c.new[id] ? { ...f, ...c.new } : f))
        else filas = [...filas, c.new]
        ordenar(); guardarCopia(); avisar({ origen: 'tiempo-real', cambio: c.eventType })
      })
      .subscribe((estado) => { if (estado === 'SUBSCRIBED') cargar() }) // recarga también al reconectar

    cargar()
    const alVolver = () => cargar()
    if (disponible) window.addEventListener('online', alVolver)
    return () => { vivo = false; cliente.removeChannel(canal); if (disponible) window.removeEventListener('online', alVolver) }
  }

  // ---------- sesión ----------
  let usuario = null, perfil = null
  const oyentesSesion = new Set()
  const avisarSesion = () => oyentesSesion.forEach((fn) => fn(usuario, perfil))
  async function cargarPerfil() {
    if (!usuario) { perfil = null; return }
    const { data } = await cliente.from('perfiles').select('*').eq('id', usuario.id).maybeSingle()
    perfil = data || null
    if (perfil) almacen.guardar(`${prefijo}perfil`, perfil)
  }
  const errorEnEspanol = (e) => {
    const m = String(e?.message || e)
    if (/Invalid login credentials/i.test(m)) return 'Correo o clave incorrectos.'
    if (/Email not confirmed/i.test(m)) return 'Falta confirmar el correo: revisa tu bandeja de entrada.'
    if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera un momento y vuelve a intentar.'
    if (esErrorDeRed(e)) return 'Sin conexión a internet.'
    return m
  }
  cliente.auth.getSession().then(async ({ data }) => {
    usuario = data.session?.user || null
    perfil = usuario ? almacen.leer(`${prefijo}perfil`, null) : null
    avisarSesion(); await cargarPerfil().catch(() => {}); avisarSesion()
  })
  cliente.auth.onAuthStateChange((evento, s) => {
    const antes = usuario?.id
    usuario = s?.user || null
    if (usuario?.id !== antes || evento === 'USER_UPDATED') setTimeout(async () => { await cargarPerfil().catch(() => {}); avisarSesion() }, 0)
    else avisarSesion()
  })
  const sesion = {
    /** { ok, error? } con mensajes en español */
    async entrar(correo, clave) { const { error } = await cliente.auth.signInWithPassword({ email: String(correo).trim(), password: clave }); return error ? { ok: false, error: errorEnEspanol(error) } : { ok: true } },
    async salir() { await cliente.auth.signOut(); almacen.guardar(`${prefijo}perfil`, null) },
    async recuperar(correo) { const { error } = await cliente.auth.resetPasswordForEmail(String(correo).trim()); return error ? { ok: false, error: errorEnEspanol(error) } : { ok: true } },
    async registrar(correo, clave, nombre) { const { error } = await cliente.auth.signUp({ email: String(correo).trim(), password: clave, options: { data: { nombre } } }); return error ? { ok: false, error: errorEnEspanol(error) } : { ok: true } },
    usuario: () => usuario,
    perfil: () => perfil,
    esAdmin: () => perfil?.rol === 'admin',
    alCambiar: (fn) => { oyentesSesion.add(fn); fn(usuario, perfil); return () => oyentesSesion.delete(fn) },
  }

  // ---------- conexión ----------
  let estadoCanal = 'reconectando'
  const oyentesConexion = new Set()
  const conexion = () => ({ estado: disponible && !navigator.onLine ? 'sin-conexion' : estadoCanal === 'SUBSCRIBED' ? 'en-linea' : estadoCanal === 'reconectando' ? 'reconectando' : 'sin-conexion', pendientes: leerCola().length })
  const avisarConexion = () => { const c = conexion(); oyentesConexion.forEach((fn) => fn(c)) }
  // canal propio solo para saber si el tiempo real está conectado
  cliente.channel(`conexion:${Math.random().toString(36).slice(2)}`).subscribe((estado) => {
    estadoCanal = estado === 'SUBSCRIBED' ? 'SUBSCRIBED' : estado === 'CLOSED' || estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' ? 'reconectando' : estadoCanal
    avisarConexion()
    if (estado === 'SUBSCRIBED') vaciarCola()
  })
  if (disponible) { window.addEventListener('online', avisarConexion); window.addEventListener('offline', avisarConexion) }

  // ---------- escrituras con cola sin internet ----------
  const llaveCola = `${prefijo}cola`
  const leerCola = () => almacen.leer(llaveCola, [])
  const avisarCola = () => { const n = leerCola().length; oyentesCola.forEach((fn) => fn(n)); avisarConexion() }

  async function aplicar(op) {
    if (op.tipo === 'guardar') return cliente.from(op.tabla).upsert(op.fila, { onConflict: op.id }).select()
    return cliente.from(op.tabla).delete().eq(op.id, op.valor)
  }
  async function enviarOEncolar(op) {
    try {
      const { data, error } = await aplicar(op)
      if (error) { if (esErrorDeRed(error)) throw error; return { ok: false, error } }
      return { ok: true, datos: data }
    } catch (e) {
      if (!esErrorDeRed(e)) return { ok: false, error: e }
      almacen.guardar(llaveCola, [...leerCola(), { ...op, en: new Date().toISOString() }]); avisarCola()
      return { ok: true, enCola: true }
    }
  }
  let vaciando = false
  async function vaciarCola() {
    if (vaciando) return
    vaciando = true
    try {
      for (const op of leerCola()) {
        try {
          const { error } = await aplicar(op)
          if (error && esErrorDeRed(error)) break
          almacen.guardar(llaveCola, leerCola().slice(1)); avisarCola() // con error de datos se descarta para no trancar la cola
        } catch { break }
      }
    } finally { vaciando = false }
  }
  if (disponible) { window.addEventListener('online', vaciarCola); setTimeout(vaciarCola, 2000) }

  return {
    cliente,
    enVivo,
    /** Inserta o actualiza (por la columna id). Sin internet queda en cola: { ok, enCola?, error? } */
    guardar: (tabla, fila, { id = 'id' } = {}) => enviarOEncolar({ tipo: 'guardar', tabla, fila, id }),
    borrar: (tabla, valor, { id = 'id' } = {}) => enviarOEncolar({ tipo: 'borrar', tabla, valor, id }),
    pendientes: () => leerCola().length,
    alCambiarPendientes: (fn) => { oyentesCola.add(fn); fn(leerCola().length); return () => oyentesCola.delete(fn) },
    sincronizar: vaciarCola,
    sesion,
    conexion,
    alCambiarConexion: (fn) => { oyentesConexion.add(fn); fn(conexion()); return () => oyentesConexion.delete(fn) },
  }
}
