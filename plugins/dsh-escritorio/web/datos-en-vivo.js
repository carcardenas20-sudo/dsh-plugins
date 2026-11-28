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

export function crearDatos({ url, clave, opciones = {}, version } = {}) {
  // En la app de escritorio cada pedido lleva la versión y el equipo: la base rechaza escrituras de apps
  // por debajo de la versión mínima y la auditoría anota desde qué equipo se hizo cada cambio.
  let info = null
  try { info = disponible && window.escritorio?.infoAhora ? window.escritorio.infoAhora() : null } catch {}
  const cabeceras = { ...(info?.version || version ? { 'x-app-version': String(info?.version || version) } : {}), ...(info?.equipo ? { 'x-equipo': String(info.equipo) } : {}) }
  const cliente = createClient(url, clave, { ...opciones, global: { ...(opciones.global || {}), headers: { ...(opciones.global?.headers || {}), ...cabeceras } } })
  const prefijo = `datos:${new URL(url).host}:`
  const oyentesCola = new Set()

  // En la app de escritorio, las automatizaciones actúan con la sesión y el rol del usuario que inició sesión aquí.
  let sesionActual = null
  const avisarEscritorio = () => {
    if (!disponible || !window.escritorio?.automatizaciones) return
    window.escritorio.automatizaciones.sesion(sesionActual, perfil ? { ...perfil, permisos: undefined, automatizaciones: rolActual?.automatizaciones || [], gestionaUsuarios: !!rolActual?.gestiona_usuarios } : null)
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
  let usuario = null, perfil = null, rolActual = null
  const oyentesSesion = new Set()
  const avisarSesion = () => oyentesSesion.forEach((fn) => fn(usuario, perfil))
  async function cargarPerfil() {
    if (!usuario) { perfil = null; rolActual = null; avisarEscritorio(); return }
    const { data } = await cliente.from('perfiles').select('*').eq('id', usuario.id).maybeSingle()
    perfil = data || null
    rolActual = null
    if (perfil?.rol) rolActual = (await cliente.from('roles').select('*').eq('nombre', perfil.rol).maybeSingle()).data || null
    if (perfil) almacen.guardar(`${prefijo}perfil`, { ...perfil, _rol: rolActual })
    avisarEscritorio()
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
    sesionActual = data.session || null
    const guardado = usuario ? almacen.leer(`${prefijo}perfil`, null) : null
    if (guardado && guardado.id === usuario?.id) { const { _rol, ...p } = guardado; perfil = p; rolActual = _rol || null }
    avisarSesion(); await cargarPerfil().catch(() => {}); avisarSesion()
  })
  cliente.auth.onAuthStateChange((evento, s) => {
    const antes = usuario?.id
    usuario = s?.user || null
    sesionActual = s || null
    if (evento === 'TOKEN_REFRESHED') avisarEscritorio()
    if (usuario?.id !== antes || evento === 'USER_UPDATED') setTimeout(async () => { await cargarPerfil().catch(() => {}); avisarSesion(); subirErrores().catch(() => {}) }, 0)
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
    rol: () => rolActual,
    /** ¿El rol puede hacer esta acción en la tabla? (para mostrar u ocultar botones; la base de datos decide de verdad) */
    puede: (tabla, accion) => perfil?.rol === 'admin' || !!rolActual?.permisos?.[tabla]?.acciones?.includes(accion),
    alcance: (tabla) => (perfil?.rol === 'admin' ? 'todo' : rolActual?.permisos?.[tabla]?.alcance || 'todo'),
    gestionaUsuarios: () => perfil?.rol === 'admin' || !!rolActual?.gestiona_usuarios,
    puedeAutomatizacion: (id) => perfil?.rol === 'admin' || (rolActual?.automatizaciones || []).some((x) => x === '*' || x === id),
    recargar: async () => { await cargarPerfil().catch(() => {}); avisarSesion() },
    alCambiar: (fn) => { oyentesSesion.add(fn); fn(usuario, perfil); return () => oyentesSesion.delete(fn) },
  }

  function traducirError(e) {
    const m = String(e?.message || e)
    if (/row-level security|violates row-level/i.test(m)) return { ...e, message: 'No tienes permiso para esto, o esta versión de la app ya no puede guardar cambios (actualízala).' }
    return e
  }

  // ---------- errores: se reportan a app_errores para que el administrador los vea (pestaña Sistema) ----------
  const llaveErrores = `${prefijo}errores`
  const recientes = new Map()
  async function reportarError(origen, mensaje, detalle = '') {
    const e = { origen, mensaje: String(mensaje).slice(0, 1000), detalle: String(detalle || '').slice(0, 4000), version: info?.version || version || null, equipo: info?.equipo || null }
    const firma = `${e.origen}:${e.mensaje}`
    if (Date.now() - (recientes.get(firma) || 0) < 60_000) return // el mismo error repetido en un minuto cuenta una vez
    recientes.set(firma, Date.now())
    const cola = [...almacen.leer(llaveErrores, []), e].slice(-50)
    almacen.guardar(llaveErrores, cola)
    await subirErrores()
  }
  async function subirErrores() {
    const cola = almacen.leer(llaveErrores, [])
    if (!cola.length || !usuario) return
    const { error } = await cliente.from('app_errores').insert(cola.map((e) => ({ equipo: e.equipo, version: e.version, origen: e.origen, mensaje: e.mensaje, detalle: e.detalle })))
    if (!error) almacen.guardar(llaveErrores, [])
  }
  if (disponible && !opciones.sinReporteDeErrores) {
    window.addEventListener('error', (ev) => reportarError('interfaz', ev.message || 'Error', `${ev.filename || ''}:${ev.lineno || ''}\n${ev.error?.stack || ''}`))
    window.addEventListener('unhandledrejection', (ev) => reportarError('interfaz', ev.reason?.message || String(ev.reason), ev.reason?.stack || ''))
    window.escritorio?.alError?.((e) => reportarError(e.origen, e.mensaje, e.detalle))
    window.escritorio?.erroresPendientes?.().then((l) => l.forEach((e) => reportarError(e.origen, e.mensaje, e.detalle))).catch(() => {})
  }

  // ---------- administración: usuarios (función del servidor) y roles ----------
  async function funcion(accion, datos = {}) {
    const { data, error } = await cliente.functions.invoke('gestionar-usuarios', { body: { accion, ...datos } })
    if (!error) return { ok: true, ...data }
    let mensaje = error.message
    try { const cuerpo = await error.context?.json?.(); if (cuerpo?.error) mensaje = cuerpo.error } catch {}
    if (/Failed to send|fetch/i.test(mensaje)) mensaje = 'No se pudo llegar a la función "gestionar-usuarios": revisa la conexión o que esté publicada en Supabase.'
    return { ok: false, error: mensaje }
  }
  const admin = {
    usuarios: {
      listar: () => funcion('listar'),
      /** { correo, clave, nombre, rol, campos: { sede: 'Norte' } } */
      crear: (u) => funcion('crear', u),
      /** (id, { nombre, rol, activo, campos }) */
      actualizar: (id, cambios) => funcion('actualizar', { id, ...cambios }),
      cambiarClave: (id, clave) => funcion('clave', { id, clave }),
      borrar: (id) => funcion('borrar', { id }),
    },
    roles: {
      async listar() { const { data, error } = await cliente.from('roles').select('*').order('nombre'); return error ? { ok: false, error: error.message } : { ok: true, roles: data } },
      /** { nombre, descripcion, permisos: { tabla: { acciones, alcance } }, automatizaciones: [], gestiona_usuarios } */
      async guardar(rol) {
        const { error } = await cliente.from('roles').upsert({ nombre: rol.nombre, descripcion: rol.descripcion ?? null, permisos: rol.permisos || {}, automatizaciones: rol.automatizaciones || [], gestiona_usuarios: !!rol.gestiona_usuarios })
        if (!error && rol.nombre === perfil?.rol) await cargarPerfil().catch(() => {})
        return error ? { ok: false, error: /row-level|permission/i.test(error.message) ? 'Solo un administrador puede cambiar roles.' : error.message } : { ok: true }
      },
      async borrar(nombre) {
        if (nombre === 'admin') return { ok: false, error: 'El rol admin no se puede borrar.' }
        const { error } = await cliente.from('roles').delete().eq('nombre', nombre)
        return error ? { ok: false, error: /foreign key|violates/i.test(error.message) ? 'Hay usuarios con ese rol: cámbiales el rol primero.' : error.message } : { ok: true }
      },
    },
    /** Errores reportados por todos los equipos. */
    async errores(limite = 100) { const { data, error } = await cliente.from('app_errores').select('*').order('creado', { ascending: false }).limit(limite); return error ? { ok: false, error: error.message } : { ok: true, errores: data } },
    /** Historial de cambios: quién cambió qué y desde qué equipo. filtro: { tabla, fila } */
    async auditoria({ tabla, fila, limite = 100 } = {}) { let q = cliente.from('auditoria').select('*').order('cuando', { ascending: false }).limit(limite); if (tabla) q = q.eq('tabla', tabla); if (fila) q = q.eq('fila', fila); const { data, error } = await q; return error ? { ok: false, error: error.message } : { ok: true, cambios: data } },
    async migraciones() { const { data, error } = await cliente.from('migraciones').select('*').order('nombre'); return error ? { ok: false, error: error.message } : { ok: true, migraciones: data } },
    /** Versión mínima de la app: por debajo, las apps se bloquean y la base no les deja guardar. */
    versionMinima: {
      async leer() { const { data } = await cliente.from('app_config').select('valor').eq('clave', 'version_minima').maybeSingle(); return data?.valor || null },
      async fijar(v) { if (v && !/^\d+\.\d+\.\d+$/.test(v)) return { ok: false, error: 'Usa el formato 1.2.0' }; const { error } = v ? await cliente.from('app_config').upsert({ clave: 'version_minima', valor: v, actualizado: new Date().toISOString() }) : await cliente.from('app_config').delete().eq('clave', 'version_minima'); return error ? { ok: false, error: /row-level/i.test(error.message) ? 'Solo un administrador puede cambiarla.' : error.message } : { ok: true } },
    },
    /** Corridas de automatizaciones de todos los equipos (quien gestiona usuarios las ve todas). */
    async corridas(limite = 50) { const { data, error } = await cliente.from('automatizacion_corridas').select('*').order('fin', { ascending: false }).limit(limite); return error ? { ok: false, error: error.message } : { ok: true, corridas: data } },
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

  // Conflictos: si la fila trae "actualizado" (la versión que vio el usuario) y en la base cambió desde entonces
  // (otro equipo la editó), NO se pisa: se devuelve { conflicto } para que el usuario decida.
  const conflictos = []
  const oyentesConflicto = new Set()
  const avisarConflictos = () => oyentesConflicto.forEach((fn) => fn([...conflictos]))
  async function aplicar(op) {
    if (op.tipo === 'guardar') {
      const fila = { ...op.fila }
      const visto = fila.actualizado
      if (visto && fila[op.id] !== undefined && !op.forzar) {
        delete fila.actualizado
        const r = await cliente.from(op.tabla).update(fila).eq(op.id, fila[op.id]).eq('actualizado', visto).select()
        if (r.error || r.data?.length) return r
        const actual = await cliente.from(op.tabla).select('*').eq(op.id, fila[op.id]).maybeSingle()
        if (actual.error) return actual
        if (actual.data) return { data: null, error: null, conflicto: { tabla: op.tabla, id: op.id, mio: op.fila, servidor: actual.data } }
        return cliente.from(op.tabla).upsert(fila, { onConflict: op.id }).select() // la borraron: se vuelve a crear
      }
      delete fila.actualizado
      return cliente.from(op.tabla).upsert(fila, { onConflict: op.id }).select()
    }
    return cliente.from(op.tabla).delete().eq(op.id, op.valor)
  }
  async function enviarOEncolar(op) {
    try {
      const { data, error, conflicto } = await aplicar(op)
      if (conflicto) { conflictos.push(conflicto); avisarConflictos(); return { ok: false, conflicto } }
      if (error) { if (esErrorDeRed(error)) throw error; return { ok: false, error: traducirError(error) } }
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
          const { error, conflicto } = await aplicar(op)
          if (error && esErrorDeRed(error)) break
          if (conflicto) { conflictos.push(conflicto); avisarConflictos() }
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
    admin,
    conexion,
    reportarError,
    /** Conflictos pendientes: [{ tabla, id, mio, servidor }] */
    conflictos: () => [...conflictos],
    alConflicto: (fn) => { oyentesConflicto.add(fn); fn([...conflictos]); return () => oyentesConflicto.delete(fn) },
    /** Resolver: 'mio' guarda tu versión encima de la del servidor; 'servidor' descarta la tuya. */
    async resolverConflicto(indice, eleccion) {
      const c = conflictos[indice]
      if (!c) return { ok: false, error: 'No existe ese conflicto' }
      conflictos.splice(indice, 1); avisarConflictos()
      if (eleccion !== 'mio') return { ok: true }
      return enviarOEncolar({ tipo: 'guardar', tabla: c.tabla, fila: c.mio, id: c.id, forzar: true })
    },
    alCambiarConexion: (fn) => { oyentesConexion.add(fn); fn(conexion()); return () => oyentesConexion.delete(fn) },
  }
}
