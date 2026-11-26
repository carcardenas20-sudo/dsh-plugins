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
  /** Consulta o cambia si la app arranca con el sistema. */
  iniciarConSistema: (activar) => ipcRenderer.invoke('inicio-sistema', activar),
})
