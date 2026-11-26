// Convierte build/icono.svg en build/icon.png (1024 px) usando el mismo Electron, sin otras dependencias.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const raiz = path.join(__dirname, '..')
const svg = path.join(raiz, 'build', 'icono.svg')
const png = path.join(raiz, 'build', 'icon.png')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } })
    const html = `<html><body style="margin:0;background:transparent">${fs.readFileSync(svg, 'utf8').replace('<svg', '<svg width="1024" height="1024"')}</body></html>`
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((r) => setTimeout(r, 400))
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
    fs.writeFileSync(png, img.resize({ width: 1024, height: 1024 }).toPNG())
    console.log('ícono listo:', path.relative(raiz, png))
    app.exit(0)
  } catch (e) { console.error('no pude crear el ícono:', e.message); app.exit(1) }
})
