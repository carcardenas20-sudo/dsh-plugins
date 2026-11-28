#!/usr/bin/env node
// Arma la carpeta del sitio de descargas de la app: la página, los instaladores de la última versión y los
// archivos que la app consulta para avisar que hay versión nueva (latest.yml, latest-mac.yml, latest-linux.yml).
// La carpeta se sube tal cual a cualquier hosting: el dominio del cliente, Netlify, Cloudflare Pages, Hostinger…
//
//   node scripts/armar-sitio.cjs --desde instaladores [--desde otra-carpeta] --salida sitio [--notas "Novedades"]
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const AQUI = path.resolve(__dirname, '..')
const plataformaDe = (n) => {
  const x = n.toLowerCase()
  if (x.endsWith('.blockmap') || /^latest.*\.ya?ml$/.test(x)) return null
  if (/\.(exe|msi)$/.test(x)) return 'windows'
  if (/\.(dmg|pkg)$/.test(x)) return 'mac'
  if (/mac.*\.zip$/.test(x)) return 'mac-zip'
  if (/\.(appimage|deb)$/.test(x)) return 'linux'
  return null
}
const leerYml = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
const versionDeYml = (t) => t?.match(/^version:\s*['"]?([^'"\s]+)/m)?.[1] || null

function armar({ desde, salida, notas = '', config, pkg }) {
  const carpetas = (Array.isArray(desde) ? desde : [desde]).map((d) => path.resolve(d)).filter((d) => fs.existsSync(d))
  if (!carpetas.length) throw new Error('No encontré carpetas con instaladores')
  const destino = path.resolve(salida)
  fs.mkdirSync(destino, { recursive: true })
  // se borra la versión anterior que hubiera en la carpeta (el sitio solo ofrece la última)
  for (const n of fs.readdirSync(destino)) if (plataformaDe(n) || n.endsWith('.blockmap') || /^latest.*\.ya?ml$/.test(n)) fs.rmSync(path.join(destino, n), { force: true })
  const archivos = {}
  let version = pkg?.version || null
  // la versión la dicen los latest*.yml; en la carpeta pueden quedar instaladores de versiones viejas
  const ymls = carpetas.flatMap((d) => fs.readdirSync(d).filter((n) => /^latest.*\.ya?ml$/.test(n)).map((n) => leerYml(path.join(d, n))))
  version = ymls.map(versionDeYml).find(Boolean) || version
  const referidos = new Set(ymls.flatMap((y) => [...(y || '').matchAll(/(?:url|path):\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((m) => m[1])))
  const esDeEstaVersion = (n) => referidos.has(n) || referidos.has(n.replace(/\.blockmap$/, '')) || (version && n.includes(version))
  for (const dir of carpetas) {
    for (const n of fs.readdirSync(dir)) {
      const f = path.join(dir, n)
      if (!fs.statSync(f).isFile()) continue
      const p = plataformaDe(n)
      const yml = /^latest.*\.ya?ml$/.test(n)
      if (!p && !yml && !n.endsWith('.blockmap')) continue
      if (/-(windows|mac|linux)\.(exe|dmg|appimage)$/i.test(n)) continue
      if (!yml && !esDeEstaVersion(n)) continue // copias con nombre fijo de GitHub: el sitio usa las versionadas
      fs.copyFileSync(f, path.join(destino, n))
      if (p && p !== 'mac-zip' && !archivos[p]) archivos[p] = { archivo: n, bytes: fs.statSync(f).size }
    }
  }
  if (!Object.keys(archivos).length) throw new Error('No hay instaladores (.exe, .dmg, .AppImage) en esas carpetas: empaqueta primero')
  if (!fs.readdirSync(destino).some((n) => /^latest.*\.ya?ml$/.test(n))) throw new Error('Faltan los latest*.yml: empaqueta con la configuración de publicación del plugin')
  const info = { nombre: config?.nombre || pkg?.productName || 'App', descripcion: config?.descripcionSitio || '', version, fecha: new Date().toISOString(), notas, archivos }
  fs.writeFileSync(path.join(destino, 'version.json'), JSON.stringify(info, null, 2) + '\n')
  // la página: la del proyecto (editable) o la plantilla del plugin
  const pagina = [path.join(AQUI, 'descargas', 'index.html'), path.join(AQUI, 'scripts', 'pagina-descargas.html')].find((x) => fs.existsSync(x))
  if (pagina) fs.copyFileSync(pagina, path.join(destino, 'index.html'))
  const icono = path.join(AQUI, 'build', 'icon.png')
  if (fs.existsSync(icono)) fs.copyFileSync(icono, path.join(destino, 'icono.png'))
  return { destino, info }
}

module.exports = { armar, plataformaDe }

if (require.main === module) {
  const args = process.argv.slice(2)
  const valores = (k) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []))
  try {
    const config = JSON.parse(fs.readFileSync(path.join(AQUI, 'escritorio.config.json'), 'utf8'))
    const pkg = JSON.parse(fs.readFileSync(path.join(AQUI, 'package.json'), 'utf8'))
    const { destino, info } = armar({ desde: valores('desde').length ? valores('desde') : [path.join(AQUI, 'instaladores')], salida: valores('salida')[0] || path.join(AQUI, 'sitio'), notas: valores('notas')[0] || '', config, pkg })
    console.log(`✅ Sitio de descargas ${info.nombre} ${info.version} en ${destino} (${Object.keys(info.archivos).join(', ')})`)
  } catch (e) { console.error(`❌ ${e.message}`); process.exit(1) }
}
