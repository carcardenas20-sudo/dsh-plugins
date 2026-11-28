// Puente seguro entre la interfaz y el sistema: la página solo ve window.escritorio.
// En el navegador normal window.escritorio no existe: úsalo con  if (window.escritorio) { … }
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('escritorio', {
  archivos: {
    /** Abre un archivo del PC. Devuelve [{ nombre, ruta, tamano, texto | base64 }] o null si cancela. */
    abrir: (op) => ipcRenderer.invoke('archivos:abrir', op),
    /** Guarda en el PC con el diálogo de "Guardar como". { nombre, contenido | base64, filtros } → { ruta } o null */
    guardar: (op) => ipcRenderer.invoke('archivos:guardar', op),
    /** Muestra el archivo en el Explorador / Finder. */
    mostrar: (ruta) => ipcRenderer.invoke('archivos:mostrar', ruta),
  },
  /** Notificación del sistema. */
  notificar: (titulo, cuerpo) => ipcRenderer.invoke('notificar', titulo, cuerpo),
  /** Abre un enlace en el navegador. */
  abrirEnNavegador: (url) => ipcRenderer.invoke('externo', url),
  /** { nombre, version, plataforma } */
  info: () => ipcRenderer.invoke('info'),
  /** { version, equipo, plataforma } al instante (para las cabeceras de la conexión a la base) */
  infoAhora: () => ipcRenderer.sendSync('info-sync'),
  /** Errores del proceso principal: alError((e) => …) y los que pasaron antes de cargar: erroresPendientes() */
  alError: (fn) => { const h = (_e, x) => fn(x); ipcRenderer.on('error-app', h); return () => ipcRenderer.removeListener('error-app', h) },
  erroresPendientes: () => ipcRenderer.invoke('errores-pendientes'),
  abrirDescargas: () => ipcRenderer.invoke('version:abrir-descargas'),
  /** Consulta o cambia si la app arranca con el sistema. */
  iniciarConSistema: (activar) => ipcRenderer.invoke('inicio-sistema', activar),
  automatizaciones: {
    /** [{ id, nombre, descripcion, cuando[], activa, ejecutando, progreso, proxima, ultima: { ok, fin, ms, error, resultado } }] */
    lista: () => ipcRenderer.invoke('auto:lista'),
    /** Pone a correr una automatización; datos llega como ctx.disparo.datos. */
    ejecutar: (id, datos) => ipcRenderer.invoke('auto:ejecutar', id, datos),
    activar: (id, activa) => ipcRenderer.invoke('auto:activar', id, activa),
    cancelar: (id) => ipcRenderer.invoke('auto:cancelar', id),
    historial: (id, n) => ipcRenderer.invoke('auto:historial', id, n),
    /** Pasa la sesión de Supabase del usuario (supabase.auth.getSession()) para que las automatizaciones actúen como él. */
    sesion: (s, info) => ipcRenderer.invoke('auto:sesion', s ? { access_token: s.access_token, refresh_token: s.refresh_token } : null, info ? JSON.parse(JSON.stringify(info)) : null),
    abrirPanel: (id) => ipcRenderer.invoke('auto:panel', id),
    abrirArchivo: (f) => ipcRenderer.invoke('auto:abrir-archivo', f),
    /** Nombres de los datos privados guardados en ESTE equipo para una automatización (nunca los valores). */
    secretos: (id) => ipcRenderer.invoke('auto:secretos', id),
    /** Guarda cifrado en este equipo (valor vacío = borrar). */
    guardarSecreto: (id, nombre, valor) => ipcRenderer.invoke('auto:secreto-guardar', id, nombre, valor),
    /** Cambios de estado: alCambiar((lista) => …) */
    alCambiar: (fn) => { const h = (_e, l) => fn(l); ipcRenderer.on('automatizaciones', h); return () => ipcRenderer.removeListener('automatizaciones', h) },
    /** Mensajes de ctx.interfaz(evento, datos): alEvento(({ id, evento, datos }) => …) */
    alEvento: (fn) => { const h = (_e, m) => fn(m); ipcRenderer.on('automatizacion:evento', h); return () => ipcRenderer.removeListener('automatizacion:evento', h) },
  },
  actualizaciones: {
    /** { estado: inactivo|buscando|al-dia|disponible|descargando|lista|error, version, progreso, version_actual } */
    estado: () => ipcRenderer.invoke('actualizacion:estado'),
    /** Busca ahora (avisa si ya está al día). */
    buscar: () => ipcRenderer.invoke('actualizacion:buscar'),
    /** Con estado "lista": reinicia e instala. Con "disponible" (Mac sin firma): abre la página de descarga. */
    instalar: () => ipcRenderer.invoke('actualizacion:instalar'),
    /** Avisa cada cambio de estado: alCambiar((estado) => …). Devuelve una función para dejar de escuchar. */
    alCambiar: (fn) => { const h = (_e, s) => fn(s); ipcRenderer.on('actualizacion', h); return () => ipcRenderer.removeListener('actualizacion', h) },
  },
})
