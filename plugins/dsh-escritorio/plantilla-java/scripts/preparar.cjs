// Deja lista la carpeta paquete/entrada para la app JavaFX:
//   web/        la interfaz (y _motor/: panel de automatizaciones y pantalla de actualización obligatoria)
//   recursos/   escritorio.config.json, versión y, si hay automatizaciones, el motor + Node + dependencias
//   icon.png    ícono de la ventana y la bandeja
'use strict'
const { execSync, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const raiz = path.join(__dirname, '..')
const config = JSON.parse(fs.readFileSync(path.join(raiz, 'escritorio.config.json'), 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'))
if (config.url) { console.error('La versión Java muestra la interfaz del propio proyecto (app/); para una web publicada usa Electron o Tauri.'); process.exit(1) }
if (config.web) execFileSync(process.execPath, [path.join(__dirname, 'traer-web.cjs')], { cwd: raiz, stdio: 'inherit' })
if (!fs.existsSync(path.join(raiz, 'app', 'index.html'))) { console.error('Falta app/index.html (la interfaz).'); process.exit(1) }

const entrada = path.join(raiz, 'paquete', 'entrada')
for (const d of ['web', 'recursos/motor', 'recursos/automatizaciones']) fs.rmSync(path.join(entrada, d), { recursive: true, force: true })
fs.mkdirSync(path.join(entrada, 'recursos'), { recursive: true })
fs.cpSync(path.join(raiz, 'app'), path.join(entrada, 'web'), { recursive: true })
fs.cpSync(path.join(raiz, 'motor', 'panel'), path.join(entrada, 'web', '_motor'), { recursive: true })
fs.copyFileSync(path.join(raiz, 'escritorio.config.json'), path.join(entrada, 'recursos', 'escritorio.config.json'))
fs.writeFileSync(path.join(entrada, 'recursos', 'version.txt'), pkg.version)

const conAutos = fs.existsSync(path.join(raiz, 'automatizaciones')) && fs.readdirSync(path.join(raiz, 'automatizaciones')).some((n) => /\.(c?js|mjs)$/.test(n))
const nodeDestino = path.join(entrada, 'recursos', process.platform === 'win32' ? 'node.exe' : 'node')
if (conAutos) {
  const rec = path.join(entrada, 'recursos')
  fs.cpSync(path.join(raiz, 'motor'), path.join(rec, 'motor'), { recursive: true, filter: (f) => !f.includes(`${path.sep}panel`) })
  fs.cpSync(path.join(raiz, 'automatizaciones'), path.join(rec, 'automatizaciones'), { recursive: true })
  const pkgRec = JSON.stringify({ name: 'motor', private: true, dependencies: pkg.dependencies || {} }, null, 2)
  const previo = fs.existsSync(path.join(rec, 'package.json')) ? fs.readFileSync(path.join(rec, 'package.json'), 'utf8') : ''
  fs.writeFileSync(path.join(rec, 'package.json'), pkgRec)
  if (previo !== pkgRec || !fs.existsSync(path.join(rec, 'node_modules'))) {
    console.log('Instalando las dependencias del motor (Supabase, Playwright)…')
    execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock', { cwd: rec, stdio: 'inherit' })
  }
  if (!fs.existsSync(nodeDestino) || fs.statSync(nodeDestino).size !== fs.statSync(process.execPath).size) fs.copyFileSync(process.execPath, nodeDestino)
  console.log(`Motor listo con Node ${process.version}.`)
} else {
  fs.rmSync(path.join(entrada, 'recursos', 'node_modules'), { recursive: true, force: true })
  fs.rmSync(nodeDestino, { force: true })
}

execFileSync(process.execPath, [path.join(__dirname, 'icono-png.cjs')], { cwd: raiz, stdio: 'inherit' })
fs.copyFileSync(path.join(raiz, 'build', 'icon.png'), path.join(entrada, 'icon.png'))
console.log('Listo para compilar.')
