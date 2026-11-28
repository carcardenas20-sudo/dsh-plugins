// Compila, prueba y empaqueta la app JavaFX solo con el JDK (21 o más nuevo): no hace falta Maven ni Gradle.
//   node scripts/java.cjs compilar      → paquete/entrada/app.jar (+ lib/ con JavaFX para este sistema)
//   node scripts/java.cjs probar        → abre la app en modo prueba (lo usa escritorio_probar)
//   node scripts/java.cjs abrir         → abre la app normal
//   node scripts/java.cjs empaquetar    → instalador con jpackage: .exe (Windows), .dmg (Mac), .deb (Linux)
// JavaFX se descarga una vez de Maven Central a ~/.dsh-escritorio/javafx (o usa DSH_JAVAFX_LIB).
'use strict'
const { spawnSync, execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const raiz = path.join(__dirname, '..')
const config = JSON.parse(fs.readFileSync(path.join(raiz, 'escritorio.config.json'), 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'))
const JAVAFX = process.env.DSH_FX_VERSION || '__VERSION_JAVAFX__'
const MODULOS = ['base', 'graphics', 'controls', 'media', 'web']
const win = process.platform === 'win32', mac = process.platform === 'darwin'
const entrada = path.join(raiz, 'paquete', 'entrada')

function herramienta(n) {
  const ext = win ? '.exe' : ''
  for (const d of [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin'), ...(process.env.PATH || '').split(path.delimiter)].filter(Boolean)) {
    const f = path.join(d, n + ext)
    if (fs.existsSync(f)) return f
  }
  throw new Error(`No encontré ${n}. Instala el JDK 21 (Windows: winget install Microsoft.OpenJDK.21 · Mac: brew install openjdk@21) y vuelve a intentar.`)
}
const correr = (bin, args, op = {}) => { const r = spawnSync(bin, args, { stdio: 'inherit', ...op }); if (r.status !== 0) throw new Error(`${path.basename(bin)} terminó con error (${r.status ?? r.signal})`); return r }

function clasificador() {
  const arm = process.arch === 'arm64'
  return win ? 'win' : mac ? (arm ? 'mac-aarch64' : 'mac') : arm ? 'linux-aarch64' : 'linux'
}

async function jarsJavaFX() {
  if (process.env.DSH_JAVAFX_LIB) return fs.readdirSync(process.env.DSH_JAVAFX_LIB).filter((n) => n.endsWith('.jar')).map((n) => path.join(process.env.DSH_JAVAFX_LIB, n))
  const dir = path.join(os.homedir(), '.dsh-escritorio', 'javafx', JAVAFX, clasificador())
  fs.mkdirSync(dir, { recursive: true })
  const jars = []
  for (const m of MODULOS) {
    const n = `javafx-${m}-${JAVAFX}-${clasificador()}.jar`
    const f = path.join(dir, n)
    if (!fs.existsSync(f)) {
      const url = `https://repo.maven.apache.org/maven2/org/openjfx/javafx-${m}/${JAVAFX}/${n}`
      console.log(`Descargando ${n}…`)
      const r = await fetch(url)
      if (!r.ok) throw new Error(`No pude descargar JavaFX (${url}): ${r.status}`)
      fs.writeFileSync(f + '.part', Buffer.from(await r.arrayBuffer()))
      fs.renameSync(f + '.part', f)
    }
    jars.push(f)
  }
  return jars
}

async function compilar() {
  const jars = await jarsJavaFX()
  const clases = path.join(raiz, 'paquete', 'clases')
  fs.rmSync(clases, { recursive: true, force: true })
  const fuentes = fs.readdirSync(path.join(raiz, 'src', 'main', 'java', 'escritorio')).filter((n) => n.endsWith('.java')).map((n) => path.join(raiz, 'src', 'main', 'java', 'escritorio', n))
  correr(herramienta('javac'), ['--release', '21', '-encoding', 'UTF-8', '-nowarn', '-d', clases, '-cp', jars.join(path.delimiter), ...fuentes])
  fs.cpSync(path.join(raiz, 'src', 'main', 'resources'), clases, { recursive: true })
  const lib = path.join(entrada, 'lib')
  fs.rmSync(lib, { recursive: true, force: true })
  fs.mkdirSync(lib, { recursive: true })
  for (const j of jars) fs.copyFileSync(j, path.join(lib, path.basename(j)))
  const manifiesto = path.join(raiz, 'paquete', 'MANIFEST.MF')
  const cp = jars.map((j) => `lib/${path.basename(j)}`)
  // Class-Path en líneas de máximo 72 bytes
  const lineas = [`Main-Class: escritorio.Lanzador`, `Class-Path: ${cp.join(' ')}`].map((l) => l.match(/.{1,70}/g).join('\n '))
  fs.writeFileSync(manifiesto, lineas.join('\n') + '\n')
  correr(herramienta('jar'), ['--create', '--file', path.join(entrada, 'app.jar'), '--manifest', manifiesto, '-C', clases, '.'])
  console.log('Compilado: paquete/entrada/app.jar')
}

function abrir(env) {
  const args = ['-Dfile.encoding=UTF-8', ...(process.env.DSH_JAVAFX_NATIVOS ? [`-Djava.library.path=${process.env.DSH_JAVAFX_NATIVOS}`] : []), '-jar', path.join(entrada, 'app.jar')]
  const java = herramienta('java')
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1440x960x24', java, ...args], { stdio: 'inherit', env: { ...process.env, ...env } })
  return spawnSync(java, args, { stdio: 'inherit', env: { ...process.env, ...env } })
}

// mismo id → mismo código de actualización: el instalador nuevo reemplaza al anterior
const uuidDe = (texto) => { const h = crypto.createHash('sha1').update(texto).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` }

async function iconoDelSistema() {
  const png = path.join(raiz, 'build', 'icon.png')
  if (win) {
    const ico = path.join(raiz, 'build', 'icon.ico')
    if (!fs.existsSync(ico)) { const pngToIco = (await import('png-to-ico')).default; fs.writeFileSync(ico, await pngToIco(png)) }
    return ico
  }
  if (mac) {
    const icns = path.join(raiz, 'build', 'icon.icns')
    if (!fs.existsSync(icns)) {
      const set = path.join(raiz, 'build', 'icon.iconset')
      fs.mkdirSync(set, { recursive: true })
      for (const t of [16, 32, 128, 256, 512]) {
        execFileSync('sips', ['-z', String(t), String(t), png, '--out', path.join(set, `icon_${t}x${t}.png`)], { stdio: 'ignore' })
        execFileSync('sips', ['-z', String(t * 2), String(t * 2), png, '--out', path.join(set, `icon_${t}x${t}@2x.png`)], { stdio: 'ignore' })
      }
      execFileSync('iconutil', ['-c', 'icns', set, '-o', icns])
    }
    return icns
  }
  return png
}

async function empaquetar() {
  const destino = path.join(raiz, 'paquete', 'instaladores')
  fs.rmSync(destino, { recursive: true, force: true })
  const tipo = process.env.DSH_JPACKAGE_TIPO || (win ? 'exe' : mac ? 'dmg' : 'deb')
  const args = [
    '--type', tipo, '--input', entrada, '--main-jar', 'app.jar', '--main-class', 'escritorio.Lanzador',
    '--name', config.nombre, '--app-version', pkg.version, '--vendor', config.empresa || config.nombre, '--description', pkg.description || config.nombre,
    '--icon', await iconoDelSistema(), '--dest', destino, '--java-options', '-Dfile.encoding=UTF-8',
    // un Java mínimo dentro del instalador (el cliente no necesita instalar Java)
    '--add-modules', 'java.base,java.desktop,java.logging,java.net.http,jdk.httpserver,jdk.unsupported,java.xml,jdk.crypto.ec,java.naming,java.management',
    '--jlink-options', '--strip-debug --no-header-files --no-man-pages',
  ]
  if (win) args.push('--win-dir-chooser', '--win-menu', '--win-shortcut', '--win-per-user-install', '--win-upgrade-uuid', uuidDe(config.id), '--win-menu-group', config.nombre)
  if (mac) args.push('--mac-package-identifier', config.id, '--mac-package-name', config.nombre.slice(0, 15))
  if (!win && !mac) args.push('--linux-shortcut', '--linux-package-name', (pkg.name || 'app').toLowerCase().replace(/[^a-z0-9-]/g, '-'), '--linux-app-category', 'Office')
  correr(herramienta('jpackage'), args)
  // nombre con versión y sistema, sin espacios (así lo usa la página de descargas)
  const base = (pkg.name || 'app')
  for (const n of fs.readdirSync(destino)) {
    const ext = path.extname(n)
    if (!['.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm'].includes(ext)) continue
    const nuevo = `${base}-${pkg.version}-${win ? 'win' : mac ? 'mac' : 'linux'}-${process.arch}${ext}`
    fs.renameSync(path.join(destino, n), path.join(destino, nuevo))
    console.log(`Instalador: paquete/instaladores/${nuevo}`)
  }
}

;(async () => {
  const orden = process.argv[2] || 'compilar'
  try {
    if (orden === 'compilar') await compilar()
    else if (orden === 'probar') {
      await compilar()
      const carpeta = process.env.DSH_ESCRITORIO_PRUEBA || path.join(raiz, '.prueba')
      fs.rmSync(carpeta, { recursive: true, force: true })
      const r = abrir({ DSH_ESCRITORIO_PRUEBA: carpeta })
      process.exit(r.status ?? 1)
    } else if (orden === 'abrir') { await compilar(); process.exit(abrir({}).status ?? 0) }
    else if (orden === 'empaquetar') { await compilar(); await empaquetar() }
    else throw new Error(`orden desconocida: ${orden}`)
  } catch (e) { console.error(`❌ ${e.message}`); process.exit(1) }
})()
