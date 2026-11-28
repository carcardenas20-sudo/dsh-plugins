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
const CARPETA_PANEL = path.join(__dirname, 'motor', 'panel')
function servirInterfaz() {
  protocol.handle('app', (req) => {
    const { pathname, host } = new URL(req.url)
    // app://motor/ = panel de automatizaciones · app://datos/<foto>.png = capturas de los robots
    if (host === 'motor') {
      const f = path.normalize(path.join(CARPETA_PANEL, decodeURIComponent(pathname) === '/' ? 'index.html' : decodeURIComponent(pathname)))
      return f.startsWith(CARPETA_PANEL) && fs.existsSync(f) ? net.fetch(pathToFileURL(f).toString()) : new Response('No existe', { status: 404 })
    }
    if (host === 'datos') {
      const base = path.join(carpetaDatosMotor(), 'capturas')
      const f = path.normalize(path.join(base, path.basename(decodeURIComponent(pathname))))
      return f.startsWith(base) && fs.existsSync(f) ? net.fetch(pathToFileURL(f).toString()) : new Response('No existe', { status: 404 })
    }
    if (CONFIG.url) return new Response('No existe', { status: 404 })
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
  bandeja.setToolTip(`${CONFIG.nombre} ${app.getVersion()}`)
  menuBandeja()
  bandeja.on('click', alternar)
}

function menuBandeja() {
  if (!bandeja) return
  const a = actualizacion
  const itemAct = a.estado === 'lista' ? { label: `Reiniciar y actualizar a ${a.version}`, click: instalarActualizacion }
    : a.estado === 'disponible' ? { label: `Descargar versión ${a.version}`, click: abrirPaginaVersiones }
    : a.estado === 'descargando' ? { label: `Descargando ${a.version}… ${a.progreso ?? 0}%`, enabled: false }
    : a.estado === 'buscando' ? { label: 'Buscando actualizaciones…', enabled: false }
    : { label: 'Buscar actualizaciones', click: () => revisarActualizaciones(true), enabled: actualizador !== null }
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: `Abrir ${CONFIG.nombre}`, click: mostrar },
    ...(CONFIG.atajo ? [{ label: `Atajo: ${CONFIG.atajo.replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl')}`, enabled: false }] : []),
    ...(motor ? [{ label: (() => { const l = motor.lista(); const v = l.filter((x) => x.ejecutando).length; return `Automatizaciones (${l.length})${v ? ` · ${v} en curso` : ''}` })(), click: () => abrirPanel() }] : []),
    { type: 'separator' },
    { label: `Versión ${app.getVersion()}`, enabled: false },
    ...(CONFIG.actualizaciones && app.isPackaged ? [itemAct] : []),
    { label: 'Iniciar con el sistema', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Salir', click: () => { saliendo = true; app.quit() } },
  ]))
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
ipcMain.handle('info', () => ({ nombre: CONFIG.nombre, version: app.getVersion(), plataforma: process.platform, equipo: EQUIPO }))
// la interfaz necesita versión y equipo al crear la conexión (cabeceras x-app-version y x-equipo)
ipcMain.on('info-sync', (ev) => { ev.returnValue = permitidoIpc(ev) ? { version: app.getVersion(), equipo: EQUIPO, plataforma: process.platform } : null })

// ---------- errores: se guardan en el equipo y la interfaz los sube a la base (app_errores) ----------
const EQUIPO = String(CONFIG.equipo || require('node:os').hostname())
const erroresPendientes = []
function registrarError(origen, error, detalle) {
  const e = { origen, mensaje: String(error?.message || error).slice(0, 1000), detalle: String(detalle || error?.stack || '').slice(0, 4000), version: app.getVersion(), equipo: EQUIPO, cuando: new Date().toISOString() }
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'errores.log'), JSON.stringify(e) + '\n') } catch {}
  erroresPendientes.push(e); if (erroresPendientes.length > 200) erroresPendientes.shift()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('error-app', e)
}
process.on('uncaughtException', (e) => registrarError('app', e))
process.on('unhandledRejection', (e) => registrarError('app', e))
app.on('render-process-gone', (_e, _wc, d) => registrarError('interfaz', `La ventana se cerró inesperadamente (${d.reason})`, JSON.stringify(d)))
app.on('child-process-gone', (_e, d) => { if (d.type !== 'Utility') registrarError('app', `Proceso ${d.type} terminó (${d.reason})`, JSON.stringify(d)) })
// la interfaz pide los errores que ocurrieron antes de que cargara o de que hubiera sesión
ipcMain.handle('errores-pendientes', (ev) => (permitidoIpc(ev) ? erroresPendientes.splice(0) : []))

// ---------- datos privados de cada equipo (claves de los robots), cifrados con el llavero del sistema ----------
const archivoSecretos = () => path.join(app.getPath('userData'), 'secretos.json')
const leerSecretos = () => { try { return JSON.parse(fs.readFileSync(archivoSecretos(), 'utf8')) } catch { return {} } }
function guardarSecreto(id, nombre, valor) {
  const { safeStorage } = require('electron')
  const todos = leerSecretos()
  todos[id] ||= {}
  if (valor === null || valor === '') delete todos[id][nombre]
  else {
    // Windows usa DPAPI y Mac el Llavero. Linux sin llavero (gnome-keyring/kwallet) solo ofrece un cifrado básico.
    if (!safeStorage.isEncryptionAvailable() && process.platform === 'linux' && safeStorage.setUsePlainTextEncryption) { safeStorage.setUsePlainTextEncryption(true); registrar('aviso: Linux sin llavero del sistema; los datos privados usan cifrado básico') }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Este equipo no tiene cifrado disponible para guardar claves')
    todos[id][nombre] = safeStorage.encryptString(String(valor)).toString('base64')
  }
  fs.writeFileSync(archivoSecretos(), JSON.stringify(todos, null, 2), { mode: 0o600 })
}
function leerSecreto(id, nombre) {
  const prueba = process.env.DSH_ESCRITORIO_SECRETOS && PRUEBA ? JSON.parse(process.env.DSH_ESCRITORIO_SECRETOS) : null
  if (prueba && prueba[`${id}.${nombre}`] !== undefined) return String(prueba[`${id}.${nombre}`])
  const cifrado = leerSecretos()[id]?.[nombre]
  if (!cifrado) return null
  try { const { safeStorage } = require('electron'); if (!safeStorage.isEncryptionAvailable() && process.platform === 'linux' && safeStorage.setUsePlainTextEncryption) safeStorage.setUsePlainTextEncryption(true); return safeStorage.decryptString(Buffer.from(cifrado, 'base64')) } catch { return null }
}
const estadoSecretos = (id) => Object.keys(leerSecretos()[id] || {})

// ---------- versión mínima: por debajo de ella la app se bloquea y pide actualizar ----------
const comparar = (a, b) => { const x = String(a).split(/[.-]/).map(Number), y = String(b).split(/[.-]/).map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0) } return 0 }
let bloqueada = null
async function revisarVersionMinima() {
  if (PRUEBA || bloqueada) return
  const minimas = []
  try { if (CONFIG.sitio) { const r = await net.fetch(new URL('version.json', CONFIG.sitio).toString(), { cache: 'no-store' }); if (r.ok) { const v = await r.json(); if (v.minima) minimas.push(v.minima) } } } catch {}
  try {
    if (CONFIG.supabase?.url) {
      const r = await net.fetch(`${CONFIG.supabase.url}/rest/v1/app_config?clave=eq.version_minima&select=valor`, { headers: { apikey: CONFIG.supabase.clave, Authorization: `Bearer ${CONFIG.supabase.clave}` } })
      if (r.ok) { const [f] = await r.json(); if (f?.valor) minimas.push(f.valor) }
    }
  } catch {}
  const minima = minimas.sort(comparar).at(-1)
  if (!minima || comparar(app.getVersion(), minima) >= 0) return
  bloqueada = minima
  registrar(`versión ${app.getVersion()} bloqueada: la mínima es ${minima}`)
  try { motor?.detener() } catch {}
  fijarActualizacion({ estado: 'obligatoria', version: minima })
  if (ventana && !ventana.isDestroyed()) { ventana.loadURL(`app://motor/bloqueo.html?actual=${encodeURIComponent(app.getVersion())}&minima=${encodeURIComponent(minima)}&nombre=${encodeURIComponent(CONFIG.nombre)}`); mostrar() }
  aviso(`${CONFIG.nombre}: actualización obligatoria`, `Esta versión (${app.getVersion()}) ya no se puede usar. Descarga la ${minima} o superior.`, abrirPaginaVersiones)
}
ipcMain.handle('version:abrir-descargas', (ev) => { if (permitidoIpc(ev)) abrirPaginaVersiones() })
ipcMain.handle('inicio-sistema', (ev, activar) => { if (permitidoIpc(ev)) { if (typeof activar === 'boolean') app.setLoginItemSettings({ openAtLogin: activar }); return app.getLoginItemSettings().openAtLogin } })

// ---------- actualizaciones automáticas (cuando hay versiones publicadas en GitHub) ----------
// Windows y Linux: descarga en segundo plano y se instala al cerrar la app (o al instante con "Reiniciar y actualizar").
// Mac: instalar solo exige firmar la app con un certificado de Apple ("macFirmada": true en escritorio.config.json);
// sin firma la app avisa de la versión nueva y abre la página de descarga.
// Registro de lo que pasó: <datos de la app>/actualizaciones.log
let actualizador = null
let actualizacion = { estado: 'inactivo' }
const MAC_SIN_FIRMA = process.platform === 'darwin' && !CONFIG.macFirmada
// "aviso": la app avisa que hay versión nueva y abre el portal de descargas; no descarga ni instala sola.
const SOLO_AVISO = MAC_SIN_FIRMA || CONFIG.actualizaciones === 'aviso'
const registrar = (m) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'actualizaciones.log'), `${new Date().toISOString()} ${m}\n`) } catch {} }
function fijarActualizacion(cambio) {
  actualizacion = { ...actualizacion, ...cambio }
  menuBandeja()
  if (ventana && !ventana.isDestroyed()) ventana.webContents.send('actualizacion', actualizacion)
}
function aviso(titulo, cuerpo, alTocar) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: titulo, body: cuerpo, icon: ICONO })
  if (alTocar) n.on('click', alTocar)
  n.show()
}
function abrirPaginaVersiones() {
  const p = (actualizador?.config ?? CONFIG.publicacion) || {}
  const url = CONFIG.paginaVersiones || (p.owner && p.repo ? `https://github.com/${p.owner}/${p.repo}/releases/latest` : null)
  registrar(`abriendo la página de descargas: ${url}`)
  if (url) shell.openExternal(url).catch(() => {})
}
function instalarActualizacion() {
  if (actualizacion.estado !== 'lista' || !actualizador) return
  registrar(`instalando ${actualizacion.version} y reiniciando`)
  saliendo = true
  setImmediate(() => actualizador.quitAndInstall(true, true))
}
function revisarActualizaciones(manual = false) {
  if (!actualizador || ['buscando', 'descargando', 'lista'].includes(actualizacion.estado)) return
  actualizador.checkForUpdates().catch((e) => { registrar(`error: ${e?.message || e}`); if (manual) aviso(CONFIG.nombre, 'No se pudo buscar actualizaciones. Revisa la conexión.') })
  if (manual) actualizacion.manual = true
}
function buscarActualizaciones() {
  if (!app.isPackaged || PRUEBA || !CONFIG.actualizaciones) return
  try { actualizador = require('electron-updater').autoUpdater } catch (e) { registrar(`sin electron-updater: ${e.message}`); return }
  const au = actualizador
  au.autoDownload = !SOLO_AVISO
  au.autoInstallOnAppQuit = !SOLO_AVISO
  au.logger = { info: (m) => registrar(m), warn: (m) => registrar(`aviso: ${m}`), error: (m) => registrar(`error: ${m}`), debug() {} }
  registrar(`versión instalada ${app.getVersion()} (${process.platform})`)
  au.on('checking-for-update', () => fijarActualizacion({ estado: 'buscando' }))
  au.on('update-not-available', () => {
    if (actualizacion.manual) aviso(CONFIG.nombre, `Tienes la última versión (${app.getVersion()}).`)
    fijarActualizacion({ estado: 'al-dia', manual: false })
  })
  au.on('update-available', (i) => {
    if (SOLO_AVISO) {
      fijarActualizacion({ estado: 'disponible', version: i.version, manual: false })
      aviso(`${CONFIG.nombre} ${i.version}`, 'Hay una versión nueva. Toca para descargarla.', abrirPaginaVersiones)
      if (process.env.DSH_ESCRITORIO_ACTUALIZAR_YA) setTimeout(abrirPaginaVersiones, 500) // para pruebas automáticas
    } else fijarActualizacion({ estado: 'descargando', version: i.version, progreso: 0, manual: false })
  })
  au.on('download-progress', (p) => { const pr = Math.round(p.percent); if (pr !== actualizacion.progreso) fijarActualizacion({ progreso: pr }) })
  au.on('update-downloaded', (i) => {
    fijarActualizacion({ estado: 'lista', version: i.version })
    aviso(`${CONFIG.nombre} ${i.version} está lista`, 'Toca para reiniciar y actualizar. Si no, se instala sola al cerrar la app.', instalarActualizacion)
    if (process.env.DSH_ESCRITORIO_ACTUALIZAR_YA) setTimeout(instalarActualizacion, 500) // para pruebas automáticas
  })
  au.on('error', (e) => fijarActualizacion({ estado: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200), manual: false }))
  setTimeout(() => revisarActualizaciones(), 3000)
  setInterval(() => { if (actualizacion.estado === 'error') actualizacion.estado = 'inactivo'; revisarActualizaciones() }, 4 * 60 * 60 * 1000)
}
ipcMain.handle('actualizacion:estado', () => ({ ...actualizacion, version_actual: app.getVersion() }))
ipcMain.handle('actualizacion:buscar', (ev) => { if (permitidoIpc(ev)) revisarActualizaciones(true) })
ipcMain.handle('actualizacion:instalar', (ev) => { if (permitidoIpc(ev)) { if (actualizacion.estado === 'disponible') abrirPaginaVersiones(); else instalarActualizacion() } })

// ---------- modo prueba: abrir, fotografiar en claro y oscuro, reportar y salir ----------
// ---------- automatizaciones (escritorio/automatizaciones/*.js) ----------
const { crearMotor } = require('./motor/motor.cjs')
const CARPETA_AUTOMATIZACIONES = path.join(__dirname, 'automatizaciones')
const carpetaDatosMotor = () => path.join(app.getPath('userData'), 'automatizaciones')
let motor = null
let panel = null
const ventanasVivas = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
function iniciarMotor({ armar = true } = {}) {
  if (!fs.existsSync(CARPETA_AUTOMATIZACIONES)) return null
  motor = crearMotor({
    carpetaAutomatizaciones: CARPETA_AUTOMATIZACIONES,
    carpetaDatos: carpetaDatosMotor(),
    config: CONFIG,
    armarDisparadores: armar,
    registrar: (m) => { try { fs.appendFileSync(path.join(carpetaDatosMotor(), 'motor.log'), `${new Date().toISOString()} ${m}\n`) } catch {} },
    avisar: (lista) => { for (const w of ventanasVivas()) w.webContents.send('automatizaciones', lista); menuBandeja() },
    notificar: (titulo, cuerpo, id) => aviso(titulo, cuerpo, () => abrirPanel(id)),
    alEventoInterfaz: (e) => { for (const w of ventanasVivas()) w.webContents.send('automatizacion:evento', e) },
    pedirSecreto: (id, nombre) => leerSecreto(id, nombre),
    alError: (id, error) => registrarError('automatizacion', `${id}: ${error}`),
  })
  return motor.cargar()
}
function abrirPanel(id) {
  const url = `app://motor/${id ? `?id=${encodeURIComponent(id)}` : ''}`
  if (panel && !panel.isDestroyed()) { panel.loadURL(url); panel.show(); panel.focus(); return }
  panel = new BrowserWindow({
    title: `Automatizaciones · ${CONFIG.nombre}`, width: 1060, height: 720, minWidth: 560, minHeight: 420, icon: ICONO, show: false, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#f5f5f7',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !PRUEBA },
  })
  panel.once('ready-to-show', () => panel.show())
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  panel.loadURL(url)
  panel.on('closed', () => { panel = null })
}
const exigir = (ev) => { if (!permitidoIpc(ev)) throw new Error('no permitido'); if (!motor) throw new Error('Esta app no tiene automatizaciones') }
ipcMain.handle('auto:lista', (ev) => { if (!permitidoIpc(ev)) throw new Error('no permitido'); return motor ? motor.lista() : [] })
ipcMain.handle('auto:ejecutar', (ev, id, datos) => { exigir(ev); return motor.ejecutar(String(id), datos) })
ipcMain.handle('auto:activar', (ev, id, activa) => { exigir(ev); motor.activar(String(id), !!activa); return true })
ipcMain.handle('auto:cancelar', (ev, id) => { exigir(ev); motor.cancelar(String(id)); return true })
ipcMain.handle('auto:historial', (ev, id, n) => { exigir(ev); return motor.historial(id ? String(id) : null, Math.min(Number(n) || 50, 500)) })
ipcMain.handle('auto:sesion', (ev, s, info) => { if (!permitidoIpc(ev)) throw new Error('no permitido'); if (!motor) return false; motor.fijarSesion(s, info); return true })
ipcMain.handle('auto:panel', (ev, id) => { if (!permitidoIpc(ev)) throw new Error('no permitido'); abrirPanel(id); return true })
ipcMain.handle('auto:secretos', (ev, id) => { exigir(ev); return estadoSecretos(String(id)) })
ipcMain.handle('auto:secreto-guardar', (ev, id, nombre, valor) => { exigir(ev); guardarSecreto(String(id), String(nombre), valor); return estadoSecretos(String(id)) })
ipcMain.handle('auto:abrir-archivo', (ev, f) => {
  if (!permitidoIpc(ev)) throw new Error('no permitido')
  const r = path.resolve(String(f))
  if (!r.startsWith(carpetaDatosMotor())) throw new Error('solo archivos de las automatizaciones')
  return shell.openPath(r)
})

async function modoPrueba() {
  const res = { nombre: CONFIG.nombre, version: app.getVersion(), plataforma: process.platform, errores: [], capturas: [], bandeja: !!bandeja, atajo: CONFIG.atajo ? globalShortcut.isRegistered(CONFIG.atajo) : null, puente: false }
  const wc = ventana.webContents
  wc.on('console-message', (_e, nivel, mensaje) => { if (nivel >= 3 && !/favicon\.ico/.test(mensaje)) res.errores.push(String(mensaje).slice(0, 300)) })
  wc.on('did-fail-load', (_e, codigo, desc, url) => res.errores.push(`no cargó ${url}: ${desc} (${codigo})`))
  wc.on('render-process-gone', (_e, d) => res.errores.push(`la interfaz se cerró: ${d.reason}`))
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
  const listo = () => new Promise((r) => { if (!wc.isLoading()) r(); else wc.once('did-finish-load', r) })
  const salir = (codigo) => { try { fs.writeFileSync(path.join(PRUEBA, 'resultado.json'), JSON.stringify(res, null, 2)) } catch {} ; saliendo = true; app.exit(codigo) }
  const conAutos = fs.existsSync(CARPETA_AUTOMATIZACIONES)
  setTimeout(() => { res.errores.push(`la prueba superó ${conAutos ? 300 : 60} s`); salir(1) }, conAutos ? 300_000 : 60_000)
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
    if (conAutos) {
      // Corre cada automatización una vez (salvo las que digan enPrueba: false) sin activar horarios ni vigilantes.
      const lista = await iniciarMotor({ armar: false })
      const solo = (process.env.DSH_ESCRITORIO_PRUEBA_AUTOS || '').split(',').filter(Boolean)
      res.automatizaciones = []
      for (const a of lista) {
        if (a.error) { res.automatizaciones.push({ id: a.id, ok: false, error: `no carga: ${a.error}` }); continue }
        if (solo.length ? !solo.includes(a.id) : a.enPrueba === false) { res.automatizaciones.push({ id: a.id, omitida: true }); continue }
        motor.ejecutar(a.id, { prueba: true })
      }
      await motor.esperarTodas()
      for (const a of motor.lista()) {
        const h = motor.historial(a.id, 1)[0]
        if (!h || res.automatizaciones.some((x) => x.id === a.id)) continue
        res.automatizaciones.push({ id: a.id, nombre: a.nombre, cuando: a.cuando, ok: h.ok, ms: h.ms, resultado: h.resultado, error: h.error, registros: h.registros.slice(-25), capturas: h.capturas.map((c) => c.archivo) })
      }
      for (const x of res.automatizaciones) if (x.ok === false) res.errores.push(`automatización ${x.id}: ${x.error}`)
      abrirPanel((res.automatizaciones.find((x) => x.capturas?.length) || res.automatizaciones.find((x) => x.ok !== undefined))?.id)
      await new Promise((r) => panel.webContents.once('did-finish-load', r))
      await esperar(1500)
      for (const [tema, nombre] of [['light', 'claro'], ['dark', 'oscuro']]) {
        nativeTheme.themeSource = tema
        await esperar(700)
        const f = path.join(PRUEBA, `panel-${nombre}.png`)
        fs.writeFileSync(f, (await panel.webContents.capturePage()).toPNG())
        res.capturas.push(f)
      }
      nativeTheme.themeSource = 'system'
    }
    salir(res.errores.length ? 1 : 0)
  } catch (e) { res.errores.push(String(e && e.message || e)); salir(1) }
}

app.whenReady().then(() => {
  servirInterfaz()
  // La interfaz no puede pedir cámara, micrófono, ubicación, etc. salvo lo que se habilite aquí.
  session.defaultSession.setPermissionRequestHandler((_wc, permiso, cb) => cb(['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permiso)))
  menuAplicacion()
  crearVentana()
  crearBandeja()
  if (CONFIG.atajo) { try { globalShortcut.register(CONFIG.atajo, alternar) } catch {} }
  buscarActualizaciones()
  if (PRUEBA) modoPrueba()
  else iniciarMotor()
  if (!PRUEBA && (CONFIG.sitio || CONFIG.supabase?.url)) { setTimeout(revisarVersionMinima, 4000); setInterval(revisarVersionMinima, 30 * 60e3) }
})
app.on('activate', mostrar) // Mac: clic en el ícono del dock
app.on('before-quit', () => { saliendo = true })
// Apagado del sistema o cierre desde la terminal: salir bien, así se instala una actualización pendiente.
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { saliendo = true; app.quit() })
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !(CONFIG.bandeja && bandeja)) app.quit() })
