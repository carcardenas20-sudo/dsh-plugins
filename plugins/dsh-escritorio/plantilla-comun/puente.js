// window.escritorio para las apps hechas con Tauri (Rust) y JavaFX (Java): la misma API que la app Electron
// (preload.js), así la interfaz y escritorio-ui.js funcionan igual en las tres. La app la carga antes que la página.
//   Tauri: llama al comando "puente" de Rust y escucha sus eventos.
//   Java:  llama a /_escritorio/llamar del servidor local de la app y escucha /_escritorio/eventos.
;(() => {
  if (window.escritorio) return
  const info = window.__ESCRITORIO_INFO__ || {}
  const tauri = window.__TAURI_INTERNALS__ || null
  const oyentes = new Map() // evento → Set(fn)
  const emitir = (nombre, datos) => (oyentes.get(nombre) || []).forEach((fn) => { try { fn(datos) } catch (e) { console.error(e) } })
  const escuchar = (nombre, fn) => { if (!oyentes.has(nombre)) oyentes.set(nombre, new Set()); oyentes.get(nombre).add(fn); return () => oyentes.get(nombre)?.delete(fn) }

  let llamar
  if (tauri) {
    llamar = (metodo, ...args) => tauri.invoke('puente', { metodo, args: JSON.parse(JSON.stringify(args)) })
    const eventos = ['automatizaciones', 'automatizacion:evento', 'actualizacion', 'error-app']
    const escucharTauri = () => {
      const ev = window.__TAURI__?.event
      if (!ev) return setTimeout(escucharTauri, 30)
      for (const n of eventos) ev.listen(n, (e) => emitir(n, e.payload))
    }
    escucharTauri()
  } else {
    const token = info.token || ''
    llamar = async (metodo, ...args) => {
      const r = await fetch('/_escritorio/llamar', { method: 'POST', headers: { 'content-type': 'application/json', 'x-escritorio': token }, body: JSON.stringify({ metodo, args }) })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Error de la app')
      return j.valor
    }
    const conectar = () => {
      const es = new EventSource(`/_escritorio/eventos?t=${encodeURIComponent(token)}`)
      es.onmessage = (m) => { try { const { evento, datos } = JSON.parse(m.data); emitir(evento, datos) } catch {} }
      es.onerror = () => { es.close(); setTimeout(conectar, 2000) }
    }
    conectar()
  }

  const errores = []
  if (info.prueba) {
    const anotar = (t) => { if (!/favicon\.ico/.test(t)) errores.push(String(t).slice(0, 300)) }
    const original = console.error.bind(console)
    console.error = (...a) => { anotar(a.map((x) => (x && x.message) || String(x)).join(' ')); original(...a) }
    window.addEventListener('error', (e) => anotar(e.message || 'Error'))
    window.addEventListener('unhandledrejection', (e) => anotar(e.reason?.message || String(e.reason)))
  }

  window.escritorio = {
    archivos: {
      abrir: (op) => llamar('archivos:abrir', op || {}),
      guardar: (op) => llamar('archivos:guardar', op || {}),
      mostrar: (ruta) => llamar('archivos:mostrar', ruta),
    },
    notificar: (titulo, cuerpo) => llamar('notificar', String(titulo ?? ''), String(cuerpo ?? '')),
    abrirEnNavegador: (url) => llamar('externo', String(url)),
    info: () => llamar('info'),
    infoAhora: () => ({ version: info.version, equipo: info.equipo, plataforma: info.plataforma }),
    alError: (fn) => escuchar('error-app', fn),
    erroresPendientes: () => llamar('errores-pendientes'),
    abrirDescargas: () => llamar('version:abrir-descargas'),
    iniciarConSistema: (activar) => llamar('inicio-sistema', typeof activar === 'boolean' ? activar : null),
    // dirección de las capturas de los robots (las muestra el panel de automatizaciones)
    fotos: info.fotos || '/_datos/',
    tecnologia: info.tecnologia,
    automatizaciones: {
      lista: () => llamar('auto:lista'),
      ejecutar: (id, datos) => llamar('auto:ejecutar', id, datos ?? null),
      activar: (id, activa) => llamar('auto:activar', id, !!activa),
      cancelar: (id) => llamar('auto:cancelar', id),
      historial: (id, n) => llamar('auto:historial', id ?? null, n ?? 50),
      sesion: (s, i) => llamar('auto:sesion', s ? { access_token: s.access_token, refresh_token: s.refresh_token } : null, i ? JSON.parse(JSON.stringify(i)) : null),
      abrirPanel: (id) => llamar('auto:panel', id ?? null),
      abrirArchivo: (f) => llamar('auto:abrir-archivo', f),
      secretos: (id) => llamar('auto:secretos', id),
      guardarSecreto: (id, nombre, valor) => llamar('auto:secreto-guardar', id, nombre, valor ?? ''),
      alCambiar: (fn) => escuchar('automatizaciones', fn),
      alEvento: (fn) => escuchar('automatizacion:evento', fn),
    },
    actualizaciones: {
      estado: () => llamar('actualizacion:estado'),
      buscar: () => llamar('actualizacion:buscar'),
      instalar: () => llamar('actualizacion:instalar'),
      alCambiar: (fn) => escuchar('actualizacion', fn),
    },
  }

  // Modo prueba (escritorio_probar): la página cuenta qué se ve y qué errores hubo.
  if (info.prueba && !location.pathname.startsWith('/_motor')) {
    // la página puede avisar cuándo terminó de cargar sus datos: window.escritorioPruebaLista = promesa (máx. 20 s)
    const informar = () => setTimeout(async () => {
      if (window.escritorioPruebaLista?.then) await Promise.race([window.escritorioPruebaLista, new Promise((r) => setTimeout(r, 20000))]).catch(() => {})
      llamar('prueba:informe', { titulo: document.title, texto: (document.body?.innerText || '').slice(0, 400), puente: typeof window.escritorio?.archivos?.guardar === 'function', errores }).catch(() => {})
    }, 1800)
    if (document.readyState === 'complete') informar(); else window.addEventListener('load', informar)
  }
})()
