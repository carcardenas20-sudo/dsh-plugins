// App de escritorio generada por dsh-escritorio (Electron).
// La configuración está en escritorio.config.json; normalmente no hace falta tocar este archivo.
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, Notification, shell, nativeImage, nativeTheme, protocol, net, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'escritorio.config.json'), 'utf8'))
const PRUEBA = process.env.DSH_ESCRITORIO_PRUEBA || '' // carpeta donde el modo prueba deja capturas y resultado
const CARPETA_WEB = path.join(__dirname, 'app')
const ICONO = [path.join(__dirname, 'build', 'icon.png'), path.join(process.resourcesPath || '', 'icon.png')].find((f) => fs.existsSync(f))

app.setName(CONFIG.nombre)
if (process.platform === 'win32') app.setAppUserModelId(CONFIG.id)

let ventana = null
let bandeja = null
let saliendo = false

// ---------- una sola instancia ----------
if (!PRUEBA && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }
app.on('second-instance', () => mostrar())

// ---------- protocolo app:// para servir la interfaz (rutas de React Router incluidas) ----------
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }])
function servirInterfaz() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url)
    let archivo = path.normalize(path.join(CARPETA_WEB, decodeURIComponent(pathname)))
    if (!archivo.startsWith(CARPETA_WEB)) return new Response('No permitido', { status: 403 })
    if (!fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      const indice = path.join(archivo, 'index.html')
      archivo = fs.existsSync(indice) ? indice : path.join(CARPETA_WEB, 'index.html') // rutas de una SPA → index.html
    }
    return net.fetch(pathToFileURL(archivo).toString())
  })
}
const direccionInicial = () => CONFIG.url || 'app://local/'
const mismoOrigen = (url) => { try { return new URL(url).origin === new URL(direccionInicial()).origin } catch { return false } }

// ---------- tamaño y posición recordados ----------
const archivoVentana = () => path.join(app.getPath('userData'), 'ventana.json')
function leerEstadoVentana() { try { return JSON.parse(fs.readFileSync(archivoVentana(), 'utf8')) } catch { return {} } }
function guardarEstadoVentana() {
  if (!ventana || ventana.isDestroyed() || ventana.isMinimized()) return
  try { fs.writeFileSync(archivoVentana(), JSON.stringify({ ...ventana.getNormalBounds(), maximizada: ventana.isMaximized() })) } catch {}
}

function crearVentana() {
  const e = PRUEBA ? {} : leerEstadoVentana()
  ventana = new BrowserWindow({
    title: CONFIG.nombre,
    width: e.width || CONFIG.ancho || 1280, height: e.height || CONFIG.alto || 820, x: e.x, y: e.y,
    minWidth: CONFIG.minAncho || 420, minHeight: CONFIG.minAlto || 520,
    show: false,
    icon: ICONO,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#f5f5f7',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, backgroundThrottling: !PRUEBA },
  })
  if (e.maximizada) ventana.maximize()
  ventana.once('ready-to-show', () => ventana.show()) // en modo prueba también: una ventana oculta congela las animaciones
  ventana.on('resize', guardarEstadoVentana)
  ventana.on('move', guardarEstadoVentana)
  ventana.on('close', (ev) => {
    guardarEstadoVentana()
    if (CONFIG.bandeja && bandeja && !saliendo) { ev.preventDefault(); ventana.hide(); avisoBandejaUnaVez() }
  })
  // Enlaces externos en el navegador; nunca se navega fuera de la app.
  ventana.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url) && !mismoOrigen(url)) shell.openExternal(url); return { action: 'deny' } })
  ventana.webContents.on('will-navigate', (ev, url) => { if (!mismoOrigen(url)) { ev.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url) } })
  ventana.loadURL(direccionInicial())
}

function mostrar() {
  if (!ventana || ventana.isDestroyed()) crearVentana()
  if (ventana.isMinimized()) ventana.restore()
  ventana.show(); ventana.focus()
}
function alternar() { if (ventana && ventana.isVisible() && ventana.isFocused()) ventana.hide(); else mostrar() }

let avisado = false
function avisoBandejaUnaVez() {
  if (avisado || !Notification.isSupported()) return
  avisado = true
  new Notification({ title: CONFIG.nombre, body: 'Sigue abierta en la bandeja. Para cerrarla del todo usa "Salir".', icon: ICONO }).show()
}

function crearBandeja() {
  if (!CONFIG.bandeja || !ICONO) return
  let img = nativeImage.createFromPath(ICONO)
  img = img.resize({ width: process.platform === 'darwin' ? 18 : 16, height: process.platform === 'darwin' ? 18 : 16 })
  bandeja = new Tray(img)
  bandeja.setToolTip(CONFIG.nombre)
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: `Abrir ${CONFIG.nombre}`, click: mostrar },
    ...(CONFIG.atajo ? [{ label: `Atajo: ${CONFIG.atajo.replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl')}`, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Iniciar con el sistema', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Salir', click: () => { saliendo = true; app.quit() } },
  ]))
  bandeja.on('click', alternar)
}

function menuAplicacion() {
  const mac = process.platform === 'darwin'
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'Archivo', submenu: [mac ? { role: 'close' } : { label: 'Salir', accelerator: 'Ctrl+Q', click: () => { saliendo = true; app.quit() } }] },
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' }, { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' }] },
    { label: 'Ver', submenu: [{ role: 'reload', label: 'Recargar' }, { role: 'resetZoom', label: 'Tamaño normal' }, { role: 'zoomIn', label: 'Acercar' }, { role: 'zoomOut', label: 'Alejar' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Pantalla completa' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'Herramientas de desarrollo' }])] },
  ]))
}

// ---------- puente con la interfaz (window.escritorio) ----------
const permitidoIpc = (ev) => { try { const u = ev.senderFrame?.url ?? ''; return u.startsWith('app://') || mismoOrigen(u) } catch { return false } }
const TEXTO = /\.(txt|csv|json|md|xml|html?|js|css|tsv|log|ya?ml)$/i
ipcMain.handle('archivos:abrir', async (ev, op = {}) => {
  if (!permitidoIpc(ev)) throw new Error('no permitido')
  const r = await dialog.showOpenDialog(ventana, { title: op.titulo, properties: op.varios ? ['openFile', 'multiSelections'] : ['openFile'], filters: op.filtros })
  if (r.canceled) return null
  return r.filePaths.map((ruta) => {
    const datos = fs.readFileSync(ruta)
    return { nombre: path.basename(ruta), ruta, tamano: datos.length, ...(TEXTO.test(ruta) || op.comoTexto ? { texto: datos.toString('utf8') } : { base64: datos.toString('base64') }) }
  })
})
ipcMain.handle('archivos:guardar', async (ev, op = {}) => {
  if (!permitidoIpc(ev)) throw new Error('no permitido')
  const r = await dialog.showSaveDialog(ventana, { title: op.titulo, defaultPath: path.join(app.getPath('documents'), path.basename(String(op.nombre || 'archivo.txt'))), filters: op.filtros })
  if (r.canceled || !r.filePath) return null
  fs.writeFileSync(r.filePath, op.base64 ? Buffer.from(op.base64, 'base64') : String(op.contenido ?? ''), op.base64 ? undefined : 'utf8')
  return { ruta: r.filePath, nombre: path.basename(r.filePath) }
})
ipcMain.handle('archivos:mostrar', (ev, ruta) => { if (permitidoIpc(ev) && typeof ruta === 'string') shell.showItemInFolder(ruta) })
ipcMain.handle('notificar', (ev, titulo, cuerpo) => { if (permitidoIpc(ev) && Notification.isSupported()) new Notification({ title: String(titulo).slice(0, 120), body: String(cuerpo ?? '').slice(0, 400), icon: ICONO }).show() })
ipcMain.handle('externo', (ev, url) => { if (permitidoIpc(ev) && /^https?:\/\//i.test(String(url))) shell.openExternal(String(url)) })
ipcMain.handle('info', () => ({ nombre: CONFIG.nombre, version: app.getVersion(), plataforma: process.platform }))
ipcMain.handle('inicio-sistema', (ev, activar) => { if (permitidoIpc(ev)) { if (typeof activar === 'boolean') app.setLoginItemSettings({ openAtLogin: activar }); return app.getLoginItemSettings().openAtLogin } })

// ---------- actualizaciones automáticas (cuando hay versiones publicadas en GitHub) ----------
function buscarActualizaciones() {
  if (!app.isPackaged || PRUEBA || !CONFIG.actualizaciones) return
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.on('update-downloaded', (info) => {
      if (Notification.isSupported()) new Notification({ title: `${CONFIG.nombre} ${info.version}`, body: 'Hay una versión nueva: se instala al cerrar la app.', icon: ICONO }).show()
    })
    autoUpdater.checkForUpdates().catch(() => {})
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
  } catch {}
}

// ---------- modo prueba: abrir, fotografiar en claro y oscuro, reportar y salir ----------
async function modoPrueba() {
  const res = { nombre: CONFIG.nombre, version: app.getVersion(), plataforma: process.platform, errores: [], capturas: [], bandeja: !!bandeja, atajo: CONFIG.atajo ? globalShortcut.isRegistered(CONFIG.atajo) : null, puente: false }
  const wc = ventana.webContents
  wc.on('console-message', (_e, nivel, mensaje) => { if (nivel >= 3 && !/favicon\.ico/.test(mensaje)) res.errores.push(String(mensaje).slice(0, 300)) })
  wc.on('did-fail-load', (_e, codigo, desc, url) => res.errores.push(`no cargó ${url}: ${desc} (${codigo})`))
  wc.on('render-process-gone', (_e, d) => res.errores.push(`la interfaz se cerró: ${d.reason}`))
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
  const listo = () => new Promise((r) => { if (!wc.isLoading()) r(); else wc.once('did-finish-load', r) })
  const salir = (codigo) => { try { fs.writeFileSync(path.join(PRUEBA, 'resultado.json'), JSON.stringify(res, null, 2)) } catch {} ; saliendo = true; app.exit(codigo) }
  setTimeout(() => { res.errores.push('la prueba superó 60 s'); salir(1) }, 60_000)
  try {
    fs.mkdirSync(PRUEBA, { recursive: true })
    await listo(); await esperar(1800)
    res.titulo = wc.getTitle()
    res.puente = await wc.executeJavaScript('typeof window.escritorio === "object" && typeof window.escritorio.archivos?.guardar === "function"')
    res.texto = (await wc.executeJavaScript('document.body ? document.body.innerText.slice(0, 400) : ""')).trim()
    for (const [tema, nombre] of [['light', 'claro'], ['dark', 'oscuro']]) {
      nativeTheme.themeSource = tema
      await esperar(700)
      const img = await wc.capturePage()
      const f = path.join(PRUEBA, `ventana-${nombre}.png`)
      fs.writeFileSync(f, img.toPNG())
      res.capturas.push(f)
    }
    nativeTheme.themeSource = 'system'
    if (!res.texto) res.errores.push('la ventana quedó en blanco')
    salir(res.errores.length ? 1 : 0)
  } catch (e) { res.errores.push(String(e && e.message || e)); salir(1) }
}

app.whenReady().then(() => {
  if (!CONFIG.url) servirInterfaz()
  // La interfaz no puede pedir cámara, micrófono, ubicación, etc. salvo lo que se habilite aquí.
  session.defaultSession.setPermissionRequestHandler((_wc, permiso, cb) => cb(['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permiso)))
  menuAplicacion()
  crearVentana()
  crearBandeja()
  if (CONFIG.atajo) { try { globalShortcut.register(CONFIG.atajo, alternar) } catch {} }
  buscarActualizaciones()
  if (PRUEBA) modoPrueba()
})
app.on('activate', mostrar) // Mac: clic en el ícono del dock
app.on('before-quit', () => { saliendo = true })
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !(CONFIG.bandeja && bandeja)) app.quit() })
