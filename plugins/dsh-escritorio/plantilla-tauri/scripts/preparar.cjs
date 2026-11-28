// Deja todo listo para compilar la app Tauri:
//   1. compila la interfaz web (si viene del proyecto) y la junta con el panel de automatizaciones en .web/
//   2. si hay automatizaciones: arma src-tauri/recursos (motor + automatizaciones + dependencias) y copia el Node
//      que viaja dentro del instalador (src-tauri/binaries/node-<sistema>)
//   3. genera los íconos de Windows, Mac y Linux desde build/icono.svg
'use strict'
const { execSync, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const raiz = path.join(__dirname, '..')
const tauri = path.join(raiz, 'src-tauri')
const config = JSON.parse(fs.readFileSync(path.join(raiz, 'escritorio.config.json'), 'utf8'))
const correr = (cmd, cwd = raiz) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, DSH_ESCRITORIO: '1' } })

// 1. interfaz
if (config.web) execFileSync(process.execPath, [path.join(__dirname, 'traer-web.cjs')], { cwd: raiz, stdio: 'inherit' })
const web = path.join(raiz, '.web')
fs.rmSync(web, { recursive: true, force: true })
if (config.url) { fs.mkdirSync(web, { recursive: true }); fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>Cargando…</title>') }
else {
  if (!fs.existsSync(path.join(raiz, 'app', 'index.html'))) { console.error('Falta app/index.html (la interfaz).'); process.exit(1) }
  fs.cpSync(path.join(raiz, 'app'), web, { recursive: true })
}
fs.cpSync(path.join(raiz, 'motor', 'panel'), path.join(web, '_motor'), { recursive: true })

// 2. motor de automatizaciones
const recursos = path.join(tauri, 'recursos')
const conAutos = fs.existsSync(path.join(raiz, 'automatizaciones')) && fs.readdirSync(path.join(raiz, 'automatizaciones')).some((n) => /\.(c?js|mjs)$/.test(n))
fs.rmSync(path.join(recursos, 'motor'), { recursive: true, force: true })
fs.rmSync(path.join(recursos, 'automatizaciones'), { recursive: true, force: true })
fs.mkdirSync(recursos, { recursive: true })
fs.copyFileSync(path.join(raiz, 'escritorio.config.json'), path.join(recursos, 'escritorio.config.json'))
const extra = { bundle: { resources: { 'recursos/': 'recursos/' } } }
if (conAutos) {
  fs.cpSync(path.join(raiz, 'motor'), path.join(recursos, 'motor'), { recursive: true, filter: (f) => !f.includes(`${path.sep}panel`) })
  fs.cpSync(path.join(raiz, 'automatizaciones'), path.join(recursos, 'automatizaciones'), { recursive: true })
  const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'))
  const deps = Object.fromEntries(Object.entries(pkg.dependencies || {}))
  const pkgRec = { name: 'motor', private: true, dependencies: deps }
  const anterior = fs.existsSync(path.join(recursos, 'package.json')) ? fs.readFileSync(path.join(recursos, 'package.json'), 'utf8') : ''
  fs.writeFileSync(path.join(recursos, 'package.json'), JSON.stringify(pkgRec, null, 2))
  if (anterior !== JSON.stringify(pkgRec, null, 2) || !fs.existsSync(path.join(recursos, 'node_modules'))) {
    console.log('Instalando las dependencias del motor (Supabase, Playwright)…')
    correr('npm install --omit=dev --no-audit --no-fund --no-package-lock', recursos)
  }
  // el Node que corre el motor: el mismo con el que se compila (Tauri lo llama "sidecar")
  const triple = execSync('rustc -vV', { encoding: 'utf8' }).match(/host: (\S+)/)[1]
  const bin = path.join(tauri, 'binaries')
  fs.mkdirSync(bin, { recursive: true })
  const destino = path.join(bin, `node-${triple}${process.platform === 'win32' ? '.exe' : ''}`)
  if (!fs.existsSync(destino) || fs.statSync(destino).size !== fs.statSync(process.execPath).size) fs.copyFileSync(process.execPath, destino)
  extra.bundle.externalBin = ['binaries/node']
  console.log(`Motor listo con Node ${process.version} (${triple}).`)
} else fs.rmSync(path.join(recursos, 'node_modules'), { recursive: true, force: true })
fs.writeFileSync(path.join(tauri, 'tauri.extra.json'), JSON.stringify(extra, null, 2))

// 3. íconos
if (!fs.existsSync(path.join(tauri, 'icons', 'icon.ico'))) {
  execFileSync(process.execPath, [path.join(__dirname, 'icono-png.cjs')], { cwd: raiz, stdio: 'inherit' })
  correr(`npx tauri icon "${path.join(raiz, 'build', 'icon.png')}" -o "${path.join(tauri, 'icons')}"`)
}
console.log('Listo para compilar.')
