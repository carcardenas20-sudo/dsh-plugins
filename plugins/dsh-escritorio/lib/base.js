// Datos base del plugin: versiones fijadas, nombres, atajos, ícono y package.json de la app.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const AQUI = path.dirname(path.dirname(fileURLToPath(import.meta.url))) // carpeta del plugin
export const VERSIONES = { electron: '45.5.0', builder: '26.18.0', updater: '6.8.11', playwright: '1.65.1', supabase: '2.119.2', ws: '8.23.0' }
export const DEFAULTS = { carpeta: 'escritorio', minutosInstalar: 20, minutosEmpaquetar: 30 }

export const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
export const limpio = (s, n = 60) => String(s ?? '').replace(/[\r\n"<>`\\]/g, '').trim().slice(0, n)
export const iniciales = (n) => (String(n).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('') || 'A').toUpperCase()

export function validarAtajo(a) {
  if (!a) return null
  const partes = String(a).split('+').map((p) => p.trim())
  const mods = new Set(['CommandOrControl', 'CmdOrCtrl', 'Command', 'Cmd', 'Control', 'Ctrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta'])
  if (partes.length < 2 || !partes.slice(0, -1).every((p) => mods.has(p)) || !/^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right)$/i.test(partes.at(-1))) {
    throw new Error(`atajo inválido "${a}". Ejemplo: CommandOrControl+Shift+K`)
  }
  return partes.join('+')
}

export const iconoSvg = (nombre, color = '#0b63f6') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".72"/></linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect x="80" y="80" width="864" height="864" rx="200" fill="#0d0d10"/>
  <rect x="80" y="80" width="864" height="864" rx="200" fill="url(#f)"/>
  <rect x="80" y="80" width="864" height="864" rx="200" fill="url(#b)"/>
  <text x="512" y="512" dy=".35em" text-anchor="middle" font-family="-apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="700" font-size="${iniciales(nombre).length > 1 ? 380 : 460}" fill="#fff" letter-spacing="-12">${iniciales(nombre)}</text>
</svg>
`

export function paqueteApp(o) {
  return {
    name: o.paquete,
    productName: o.nombre,
    version: o.version,
    description: o.descripcion || o.nombre,
    author: o.autor || o.nombre,
    main: 'main.js',
    private: true,
    scripts: {
      start: 'electron .',
      web: 'node scripts/traer-web.cjs',
      icono: 'electron scripts/icono.cjs',
      'dist:win': 'electron-builder --win',
      'dist:mac': 'electron-builder --mac',
      'dist:linux': 'electron-builder --linux',
    },
    dependencies: { 'electron-updater': VERSIONES.updater, 'playwright-core': VERSIONES.playwright, '@supabase/supabase-js': VERSIONES.supabase, ws: VERSIONES.ws },
    devDependencies: { electron: VERSIONES.electron, 'electron-builder': VERSIONES.builder },
    build: {
      appId: o.id,
      productName: o.nombre,
      directories: { output: 'instaladores', buildResources: 'build' },
      files: ['main.js', 'preload.js', 'escritorio.config.json', 'app/**/*', 'motor/**/*', 'automatizaciones/**/*', 'build/icon.png', 'package.json'],
      extraResources: [{ from: 'build/icon.png', to: 'icon.png' }],
      artifactName: `${slug(o.nombre) || 'app'}-` + '${version}-${os}-${arch}.${ext}', // sin espacios: GitHub los cambia y rompería las actualizaciones
      win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'build/icon.png' },
      nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: o.nombre, uninstallDisplayName: o.nombre, language: '3082' },
      mac: { target: [{ target: 'dmg', arch: ['universal'] }, { target: 'zip', arch: ['universal'] }], icon: 'build/icon.png', category: 'public.app-category.productivity', identity: null },
      dmg: { title: o.nombre },
      linux: { target: ['AppImage'], icon: 'build/icon.png', category: 'Office' },
      ...(o.github ? { publish: [{ provider: 'github', owner: o.github.owner, repo: o.github.repo, releaseType: 'release' }] } : {}),
    },
  }
}

