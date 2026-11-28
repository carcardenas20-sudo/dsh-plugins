// Apps de escritorio con Tauri (Rust) y JavaFX (Java): crean la carpeta de la app, la compilan para probarla y
// arman los instaladores. Usan la misma interfaz web, el mismo motor de automatizaciones (Node) y la misma
// página de descargas que la versión Electron.
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AQUI, VERSIONES, slug } from './base.js'

export const TECNOLOGIAS = ['electron', 'tauri', 'java']
export const VERSIONES_OTRAS = { tauriCli: '2.12.6', resvg: '2.6.2', pngIco: '3.0.2', javafx: '21.0.6', java: 21 }

const comunes = async (dir) => {
  await cp(path.join(AQUI, 'plantilla', 'motor'), path.join(dir, 'motor'), { recursive: true })
  await mkdir(path.join(dir, 'scripts'), { recursive: true })
  for (const f of ['traer-web.cjs', 'armar-sitio.cjs', 'pagina-descargas.html']) await cp(path.join(AQUI, 'plantilla', 'scripts', f), path.join(dir, 'scripts', f))
  await cp(path.join(AQUI, 'plantilla-comun', 'scripts', 'icono-png.cjs'), path.join(dir, 'scripts', 'icono-png.cjs'))
}
const depsMotor = () => ({ '@supabase/supabase-js': VERSIONES.supabase, ws: VERSIONES.ws, 'playwright-core': VERSIONES.playwright })

/** Nombre válido para Cargo y para el ejecutable: minúsculas, números y guiones, empieza con letra. */
export const nombreBinario = (nombre) => { const s = slug(nombre) || 'app'; return /^[a-z]/.test(s) ? s : `app-${s}` }

export async function crearTauri(dir, o) {
  await cp(path.join(AQUI, 'plantilla-tauri'), dir, { recursive: true })
  await comunes(dir)
  await cp(path.join(AQUI, 'plantilla-comun', 'puente.js'), path.join(dir, 'puente.js'))
  const bin = nombreBinario(o.nombre)
  const cargo = path.join(dir, 'src-tauri', 'Cargo.toml')
  await writeFile(cargo, (await readFile(cargo, 'utf8')).replaceAll('app-escritorio', bin))
  const conf = JSON.parse(await readFile(path.join(dir, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  conf.productName = o.nombre
  conf.identifier = o.id
  conf.mainBinaryName = bin
  await writeFile(path.join(dir, 'src-tauri', 'tauri.conf.json'), JSON.stringify(conf, null, 2) + '\n')
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: o.paquete, productName: o.nombre, version: o.version, private: true,
    scripts: {
      preparar: 'node scripts/preparar.cjs',
      probar: 'node scripts/preparar.cjs && tauri build --debug --no-bundle --config src-tauri/tauri.extra.json',
      empaquetar: 'node scripts/preparar.cjs && tauri build --config src-tauri/tauri.extra.json',
    },
    dependencies: depsMotor(),
    devDependencies: { '@tauri-apps/cli': VERSIONES_OTRAS.tauriCli, '@resvg/resvg-js': VERSIONES_OTRAS.resvg },
  }, null, 2) + '\n')
  await writeFile(path.join(dir, '.gitignore'), ['node_modules/', 'instaladores/', '.web/', '.prueba/', 'src-tauri/target/', 'src-tauri/recursos/', 'src-tauri/binaries/', 'src-tauri/gen/', 'src-tauri/tauri.extra.json', ...(o.web ? ['app/'] : [])].join('\n') + '\n')
  return { binario: bin }
}

export async function crearJava(dir, o) {
  await cp(path.join(AQUI, 'plantilla-java'), dir, { recursive: true })
  await comunes(dir)
  const recursosJava = path.join(dir, 'src', 'main', 'resources', 'escritorio')
  await mkdir(recursosJava, { recursive: true })
  await cp(path.join(AQUI, 'plantilla-comun', 'puente.js'), path.join(recursosJava, 'puente.js'))
  const bin = nombreBinario(o.nombre)
  const script = path.join(dir, 'scripts', 'java.cjs')
  await writeFile(script, (await readFile(script, 'utf8')).replaceAll('__VERSION_JAVAFX__', VERSIONES_OTRAS.javafx))
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: o.paquete, productName: o.nombre, version: o.version, private: true,
    scripts: { preparar: 'node scripts/preparar.cjs', probar: 'node scripts/preparar.cjs && node scripts/java.cjs probar', empaquetar: 'node scripts/preparar.cjs && node scripts/java.cjs empaquetar' },
    dependencies: depsMotor(),
    devDependencies: { '@resvg/resvg-js': VERSIONES_OTRAS.resvg, 'png-to-ico': VERSIONES_OTRAS.pngIco },
  }, null, 2) + '\n')
  await writeFile(path.join(dir, '.gitignore'), ['node_modules/', 'instaladores/', '.prueba/', 'target/', 'paquete/', ...(o.web ? ['app/'] : [])].join('\n') + '\n')
  return { binario: bin }
}

/** Busca en las carpetas de compilación los instaladores recién hechos y los copia a instaladores/. */
export async function juntarInstaladores(dir, tecnologia, version) {
  const origenes = tecnologia === 'tauri'
    ? ['nsis', 'msi', 'dmg', 'macos', 'appimage', 'deb'].map((d) => path.join(dir, 'src-tauri', 'target', 'release', 'bundle', d))
    : [path.join(dir, 'paquete', 'instaladores')]
  const destino = path.join(dir, 'instaladores')
  await mkdir(destino, { recursive: true })
  const hechos = []
  for (const o of origenes) {
    if (!existsSync(o)) continue
    for (const n of await readdir(o)) {
      if (!/\.(exe|msi|dmg|appimage|deb|pkg)$/i.test(n) || (version && !n.includes(version))) continue
      const f = path.join(o, n)
      await cp(f, path.join(destino, n))
      hechos.push({ archivo: n, bytes: (await stat(f)).size })
    }
  }
  return hechos
}

export async function limpiarCompilacion(dir) {
  await rm(path.join(dir, '.prueba'), { recursive: true, force: true })
}
