// dsh-escritorio — convierte la interfaz del proyecto en una app de escritorio para Windows y Mac
// (Electron): ventana con tamaño recordado, bandeja del sistema, atajo global, archivos del PC,
// notificaciones, arranque con el sistema, una sola instancia y actualizaciones automáticas.
// El agente la prueba abriéndola de verdad (capturas en claro y oscuro), la empaqueta como
// instalador y deja GitHub Actions compilando Windows y Mac a la vez.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'escritorio'
export const inject = ['tools', 'workingDirectory', 'systemPrompt']

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const VERSIONES = { electron: '33.2.1', builder: '25.1.8', updater: '6.3.9' }
const DEFAULTS = { carpeta: 'escritorio', minutosInstalar: 20, minutosEmpaquetar: 30 }

export const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
const limpio = (s, n = 60) => String(s ?? '').replace(/[\r\n"<>`\\]/g, '').trim().slice(0, n)
const iniciales = (n) => (String(n).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('') || 'A').toUpperCase()

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
    dependencies: { 'electron-updater': VERSIONES.updater },
    devDependencies: { electron: VERSIONES.electron, 'electron-builder': VERSIONES.builder },
    build: {
      appId: o.id,
      productName: o.nombre,
      directories: { output: 'instaladores', buildResources: 'build' },
      files: ['main.js', 'preload.js', 'escritorio.config.json', 'app/**/*', 'build/icon.png', 'package.json'],
      extraResources: [{ from: 'build/icon.png', to: 'icon.png' }],
      artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
      win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'build/icon.png' },
      nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: o.nombre, uninstallDisplayName: o.nombre, language: '3082' },
      mac: { target: [{ target: 'dmg', arch: ['universal'] }], icon: 'build/icon.png', category: 'public.app-category.productivity', identity: null },
      dmg: { title: o.nombre },
      linux: { target: ['AppImage'], icon: 'build/icon.png', category: 'Office' },
      ...(o.github ? { publish: [{ provider: 'github', owner: o.github.owner, repo: o.github.repo, releaseType: 'release' }] } : {}),
    },
  }
}

export function flujoGithub({ dirRel, webDirRel, nombre }) {
  const enDir = dirRel === '.' ? '' : `\n        working-directory: ${dirRel}`
  return `# Compila ${nombre} para Windows y Mac en los servidores de GitHub (generado por dsh-escritorio).
# - Cada vez que subas una etiqueta escritorio-v1.2.3 se crea una versión con los instaladores
#   y las apps instaladas se actualizan solas.
# - También se puede lanzar a mano desde la pestaña Actions ("Run workflow"): deja los instaladores
#   como archivos descargables de esa ejecución.
name: Escritorio

on:
  push:
    tags: ['escritorio-v*']
  workflow_dispatch:

permissions:
  contents: write

jobs:
  compilar:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
${webDirRel ? `      - name: Dependencias de la interfaz
        run: npm install --no-audit --no-fund
        working-directory: ${webDirRel}
` : ''}      - name: Dependencias de la app${enDir}
        run: npm install --no-audit --no-fund
      - name: Interfaz${enDir}
        run: npm run web
      - name: Versión desde la etiqueta
        if: startsWith(github.ref, 'refs/tags/escritorio-v')${enDir}
        shell: bash
        run: npm pkg set version="\${GITHUB_REF_NAME#escritorio-v}"
      - name: Mac sin Spotlight (evita que el .dmg quede "ocupado")
        if: runner.os == 'macOS'
        run: sudo mdutil -a -i off
      - name: Instaladores${enDir}
        shell: bash
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
        run: |
          if [[ "$GITHUB_REF" == refs/tags/escritorio-v* ]]; then PUB=always; else PUB=never; fi
          if [[ "$RUNNER_OS" == "Windows" ]]; then npx electron-builder --win --publish $PUB; else npx electron-builder --mac --publish $PUB; fi
      - uses: actions/upload-artifact@v4
        with:
          name: ${slug(nombre)}-\${{ runner.os }}
          path: |
            ${dirRel === '.' ? '' : `${dirRel}/`}instaladores/*.exe
            ${dirRel === '.' ? '' : `${dirRel}/`}instaladores/*.dmg
          if-no-files-found: error
`
}

const PAGINA_INICIAL = (o) => `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.nombre}</title>
<style>
:root{--fondo:#f5f5f7;--sup:#fff;--tinta:#1d1d1f;--suave:#515154;--borde:rgba(0,0,0,.09);--acento:${o.color};color-scheme:light}
@media (prefers-color-scheme:dark){:root{--fondo:#000;--sup:#161618;--tinta:#f5f5f7;--suave:#c7c7cc;--borde:rgba(255,255,255,.1);color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--fondo);color:var(--tinta);font:16px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif}
main{width:min(560px,calc(100% - 32px));background:var(--sup);border:1px solid var(--borde);border-radius:22px;padding:32px;display:grid;gap:16px;box-shadow:0 10px 40px rgba(0,0,0,.08)}
h1{margin:0;font-size:28px;letter-spacing:-.02em}p{margin:0;color:var(--suave)}
.fila{display:flex;flex-wrap:wrap;gap:10px}button{font:600 15px inherit;font-family:inherit;border:0;border-radius:999px;padding:11px 18px;cursor:pointer;background:var(--acento);color:#fff}
button.sec{background:transparent;color:var(--acento);box-shadow:inset 0 0 0 1px var(--acento)}
pre{margin:0;background:var(--fondo);border-radius:12px;padding:12px;font:13px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;color:var(--suave);min-height:48px}
</style></head><body><main>
<h1>${o.nombre}</h1><p>App de escritorio lista. Reemplaza esta página por tu interfaz (carpeta app/) o conecta tu proyecto web.</p>
<div class="fila"><button id="abrir">Abrir un archivo</button><button class="sec" id="guardar">Guardar una nota</button><button class="sec" id="avisar">Notificación</button></div>
<pre id="salida">${o.nombre} · listo</pre>
</main><script>
const s=document.getElementById('salida'),e=window.escritorio;
if(!e){s.textContent='Abierto en el navegador: las funciones de escritorio solo existen dentro de la app.'}
else{e.info().then(i=>s.textContent=i.nombre+' '+i.version+' · '+i.plataforma);
document.getElementById('abrir').onclick=async()=>{const r=await e.archivos.abrir({filtros:[{name:'Texto',extensions:['txt','csv','json','md']}]});if(r)s.textContent=r[0].nombre+'\\n'+(r[0].texto||'').slice(0,400)};
document.getElementById('guardar').onclick=async()=>{const r=await e.archivos.guardar({nombre:'nota.txt',contenido:'Guardado desde ${o.nombre}: '+new Date().toLocaleString()});if(r)s.textContent='Guardado en '+r.ruta};
document.getElementById('avisar').onclick=()=>e.notificar('${o.nombre}','Las notificaciones funcionan.');}
</script></body></html>
`

const LEEME = (o) => `# ${o.nombre} — app de escritorio

Generada con dsh-escritorio (Electron ${VERSIONES.electron}).

| Comando (en esta carpeta) | Qué hace |
|---|---|
| \`npm install\` | Una sola vez: descarga Electron y las herramientas. |
| \`npm run web\` | ${o.web ? `Compila la interfaz de \`${o.web.carpeta}\` y la copia a \`app/\`.` : 'Nada: la interfaz ya está en `app/`.'} |
| \`npm start\` | Abre la app para probarla. |
| \`npm run dist:win\` / \`dist:mac\` | Crea el instalador en \`instaladores/\`. |

- Ajustes (nombre, tamaño, bandeja, atajo): \`escritorio.config.json\`. Ícono: \`build/icono.svg\` → \`npm run icono\`.
- Desde la interfaz: \`window.escritorio.archivos.abrir()\`, \`.guardar()\`, \`window.escritorio.notificar()\` (solo dentro de la app; en el navegador no existe).
- Windows muestra "Windows protegió tu PC" la primera vez porque el instalador no está firmado: "Más información" → "Ejecutar de todas formas". En Mac: clic derecho → Abrir. Para quitar esos avisos hace falta firmar (certificado de Windows / cuenta de desarrollador de Apple).
`

const REGLAS = [
  '## Escritorio (dsh-escritorio)',
  'When the user wants a desktop app (Windows/Mac installer, tray icon, global shortcut, access to local files, "que se instale en el PC"), use the dsh-escritorio tools instead of hand-writing Electron code:',
  '1. escritorio_crear wraps the project UI (Vite/React build, a static folder, a deployed URL, or a new starter page). For Vite it builds with base "./" automatically.',
  '2. In the UI, desktop features go through window.escritorio (archivos.abrir/guardar/mostrar, notificar, abrirEnNavegador, info, iniciarConSistema); always guard with `if (window.escritorio)` so the web version keeps working, with a browser fallback (download/upload).',
  '3. Always run escritorio_probar after creating or changing it: it really opens the app, checks errors, the bridge, tray and shortcut, and returns light/dark screenshots. Look at them and fix problems before saying it works.',
  '4. escritorio_empaquetar builds the installer for this computer. For Windows and Mac together and auto-updates, escritorio_publicar writes the GitHub Actions workflow; never push, tag or publish without the user\'s explicit approval.',
  '5. Be honest about signing: unsigned installers show a warning the first time on Windows (SmartScreen) and Mac (Gatekeeper).',
].join('\n')

// ---------- procesos ----------

function correr(cmd, args, { cwd, timeoutMs, signal, env } = {}) {
  return new Promise((resolve) => {
    let salida = ''
    let h
    try {
      h = spawn(cmd, args, { cwd, signal, windowsHide: true, shell: process.platform === 'win32', env: { ...process.env, ...env } })
    } catch (e) { return resolve({ codigo: null, salida: String(e.message) }) }
    const t = setTimeout(() => h.kill(), timeoutMs ?? 10 * 60_000)
    const mas = (b) => { salida += b.toString('utf8'); if (salida.length > 200_000) salida = salida.slice(-100_000) }
    h.stdout?.on('data', mas); h.stderr?.on('data', mas)
    h.on('error', (e) => { clearTimeout(t); resolve({ codigo: null, salida: salida + String(e.message) }) })
    h.on('close', (codigo) => { clearTimeout(t); resolve({ codigo, salida }) })
  })
}
const finalDe = (t, n = 3000) => (t.length > n ? '…' + t.slice(-n) : t)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

async function raizGit(desde) {
  let d = desde
  for (let i = 0; i < 12; i++) { if (existsSync(path.join(d, '.git'))) return d; const p = path.dirname(d); if (p === d) break; d = p }
  return null
}

async function repoGithub(raiz) {
  try {
    const cfg = await readFile(path.join(raiz, '.git', 'config'), 'utf8')
    const m = /url\s*=\s*.*github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\s*$/m.exec(cfg)
    return m ? { owner: m[1], repo: m[2] } : null
  } catch { return null }
}

async function detectarWeb(cwd) {
  try {
    const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps.vite && pkg.scripts?.build) return { tipo: 'vite', comando: 'npm run build -- --base=./', salida: 'dist' }
    if (pkg.scripts?.build) return { tipo: 'build', comando: 'npm run build', salida: existsSync(path.join(cwd, 'build')) ? 'build' : 'dist' }
  } catch {}
  return null
}

async function tamanoLegible(f) { const s = await stat(f); return s.size > 1e6 ? `${(s.size / 1e6).toFixed(1)} MB` : `${Math.round(s.size / 1e3)} KB` }

// ---------- plugin ----------

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}) }
  ctx.systemPrompt.section({ name: 'escritorio', order: 2485, interpolate: false, text: REGLAS })
  const salida = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }
  const dirApp = (cwd, carpeta) => {
    const rel = String(carpeta || cfg.carpeta).replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '')
    if (!rel || rel.split('/').includes('..') || path.isAbsolute(rel)) throw new Error('"carpeta" debe estar dentro del proyecto')
    return { dir: path.join(cwd, rel), rel }
  }
  const leerConfig = async (dir) => { try { return JSON.parse(await readFile(path.join(dir, 'escritorio.config.json'), 'utf8')) } catch { return null } }

  async function instalarSiFalta(dir, signal) {
    if (existsSync(path.join(dir, 'node_modules', 'electron')) && existsSync(path.join(dir, 'node_modules', 'electron-builder'))) return null
    const r = await correr(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir, signal, timeoutMs: cfg.minutosInstalar * 60_000 })
    if (r.codigo !== 0) throw new Error(`no pude instalar las dependencias de la app (npm install):\n${finalDe(r.salida)}`)
    return 'Dependencias instaladas (Electron descargado).'
  }
  async function prepararInterfaz(dir, conf, signal) {
    if (!conf.web) return null
    const r = await correr('node', ['scripts/traer-web.cjs'], { cwd: dir, signal, timeoutMs: 10 * 60_000 })
    if (r.codigo !== 0) throw new Error(`falló la compilación de la interfaz:\n${finalDe(r.salida)}`)
    return 'Interfaz compilada y copiada a app/.'
  }
  async function asegurarIcono(dir, signal) {
    if (existsSync(path.join(dir, 'build', 'icon.png'))) return null
    const r = await correrElectron(dir, ['scripts/icono.cjs'], signal, 120_000)
    if (r.codigo !== 0 || !existsSync(path.join(dir, 'build', 'icon.png'))) throw new Error(`no pude generar el ícono:\n${finalDe(r.salida)}`)
    return 'Ícono generado (build/icon.png).'
  }
  async function correrElectron(dir, args, signal, timeoutMs, env) {
    const bin = process.platform === 'win32' ? path.join(dir, 'node_modules', '.bin', 'electron.cmd') : path.join(dir, 'node_modules', '.bin', 'electron')
    const extra = process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      return correr('xvfb-run', ['-a', '-s', '-screen 0 1440x960x24', bin, ...args, ...extra], { cwd: dir, signal, timeoutMs, env })
    }
    return correr(bin, [...args, ...extra], { cwd: dir, signal, timeoutMs, env })
  }

  ctx.tools.register({
    name: 'escritorio_crear',
    description: 'Crea la app de escritorio (Windows y Mac, con Electron) en escritorio/: ventana que recuerda su tamaño, bandeja del sistema, atajo global, acceso a archivos del PC, notificaciones, arranque con el sistema, una sola instancia, actualizaciones automáticas e ícono. La interfaz puede ser el proyecto web (Vite/React: se compila solo), una carpeta con HTML ya hecho, una URL desplegada o una página inicial nueva.',
    parameters: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre visible de la app, ej. "Créditos Suzuka"' },
        origen: { type: 'string', enum: ['proyecto', 'carpeta', 'url', 'nueva'], description: 'proyecto = compilar la interfaz web de este proyecto (por defecto si hay package.json con build); carpeta = HTML estático; url = una web ya publicada; nueva = página inicial' },
        carpetaWeb: { type: 'string', description: 'origen proyecto: carpeta del proyecto web (por defecto la raíz); origen carpeta: carpeta con index.html' },
        url: { type: 'string', description: 'origen url: dirección https de la app publicada' },
        id: { type: 'string', description: 'Identificador único, ej. com.suzuka.creditos (por defecto se arma con el nombre)' },
        color: { type: 'string', description: 'Color del ícono en hex (por defecto #0b63f6)' },
        bandeja: { type: 'boolean', description: 'Ícono en la bandeja del sistema y seguir abierta al cerrar la ventana (por defecto sí)' },
        atajo: { type: 'string', description: 'Atajo global para mostrar/ocultar, ej. CommandOrControl+Shift+K (opcional)' },
        carpeta: { type: 'string', description: 'Dónde crear la app (por defecto escritorio/)' },
      },
      required: ['nombre'],
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { dir, rel } = dirApp(cwd, args.carpeta)
      if (existsSync(path.join(dir, 'escritorio.config.json'))) throw new Error(`ya existe ${rel}/; edita escritorio.config.json o usa otra carpeta`)
      const nombre = limpio(args.nombre, 40)
      if (!nombre) throw new Error('"nombre" está vacío')
      const color = /^#[0-9a-f]{6}$/i.test(args.color ?? '') ? args.color : '#0b63f6'
      const atajo = validarAtajo(args.atajo)
      let origen = args.origen
      const webDir = path.resolve(cwd, args.carpetaWeb || '.')
      if (path.relative(cwd, webDir).startsWith('..')) throw new Error('"carpetaWeb" debe estar dentro del proyecto')
      const web = await detectarWeb(webDir)
      if (!origen) origen = args.url ? 'url' : web ? 'proyecto' : 'nueva'
      const conf = { nombre, id: limpio(args.id, 80) || `com.${slug(path.basename(cwd)).replace(/-/g, '') || 'app'}.${slug(nombre).replace(/-/g, '') || 'app'}`, ancho: 1280, alto: 820, minAncho: 420, minAlto: 520, bandeja: args.bandeja !== false, atajo, actualizaciones: true }
      if (origen === 'url') {
        if (!/^https:\/\/[^\s]+$/i.test(args.url ?? '')) throw new Error('"url" debe ser una dirección https://')
        conf.url = args.url
      } else if (origen === 'proyecto') {
        if (!web) throw new Error(`no encontré un proyecto web con "build" en ${path.relative(cwd, webDir) || 'la raíz'}; usa origen "carpeta" o "nueva"`)
        conf.web = { carpeta: path.relative(dir, webDir).split(path.sep).join('/') || '.', comando: web.comando, salida: web.salida }
      } else if (origen === 'carpeta') {
        if (!existsSync(path.join(webDir, 'index.html'))) throw new Error(`no hay index.html en ${path.relative(cwd, webDir) || 'la raíz'}`)
        conf.web = { carpeta: path.relative(dir, webDir).split(path.sep).join('/') || '.', salida: '.' }
      }
      await mkdir(dir, { recursive: true })
      await cp(path.join(AQUI, 'plantilla'), dir, { recursive: true })
      await mkdir(path.join(dir, 'build'), { recursive: true })
      await mkdir(path.join(dir, 'app'), { recursive: true })
      const raiz = await raizGit(cwd)
      const github = raiz ? await repoGithub(raiz) : null
      const o = { nombre, paquete: slug(nombre) || 'app-escritorio', version: '1.0.0', id: conf.id, github, color, web: conf.web }
      await writeFile(path.join(dir, 'package.json'), JSON.stringify(paqueteApp(o), null, 2) + '\n')
      await writeFile(path.join(dir, 'escritorio.config.json'), JSON.stringify(conf, null, 2) + '\n')
      await writeFile(path.join(dir, 'build', 'icono.svg'), iconoSvg(nombre, color))
      if (origen === 'nueva') await writeFile(path.join(dir, 'app', 'index.html'), PAGINA_INICIAL({ nombre, color }))
      await writeFile(path.join(dir, '.gitignore'), 'node_modules/\ninstaladores/\n' + (conf.web ? 'app/\n' : ''))
      await writeFile(path.join(dir, 'LEEME.md'), LEEME(o))
      return [
        `Creada la app de escritorio "${nombre}" en ${rel}/ (interfaz: ${origen === 'proyecto' ? `proyecto web ${conf.web.carpeta === '..' ? 'de la raíz' : conf.web.carpeta}, se compila con "${conf.web.comando}"` : origen === 'carpeta' ? `carpeta ${path.relative(cwd, webDir) || '.'}` : origen === 'url' ? conf.url : 'página inicial nueva en app/index.html'}).`,
        `Bandeja: ${conf.bandeja ? 'sí' : 'no'} · Atajo: ${atajo ?? 'ninguno'} · Actualizaciones: ${github ? `GitHub ${github.owner}/${github.repo}` : 'sin repositorio de GitHub detectado'}.`,
        origen === 'proyecto' ? 'Las rutas de React Router funcionan: cualquier ruta vuelve a index.html.' : '',
        'Siguiente: llama escritorio_probar (instala Electron la primera vez, unos minutos, y abre la app para verificarla).',
      ].filter(Boolean).join('\n')
    },
  })

  ctx.tools.register({
    name: 'escritorio_probar',
    description: 'Prueba la app de escritorio de verdad (se ve abrirse unos segundos): instala dependencias si faltan, compila la interfaz, genera el ícono, abre la app, verifica que cargue sin errores, que exista window.escritorio, la bandeja y el atajo, y devuelve capturas de la ventana en claro y oscuro.',
    timeoutMs: (DEFAULTS.minutosInstalar + 12) * 60_000,
    parameters: { type: 'object', properties: { carpeta: { type: 'string' } } },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { dir, rel } = dirApp(cwd, args?.carpeta)
      const conf = await leerConfig(dir)
      if (!conf) return `No hay app de escritorio en ${rel}/. Créala con escritorio_crear.`
      const pasos = []
      try {
        for (const p of [await instalarSiFalta(dir, exec.signal), await prepararInterfaz(dir, conf, exec.signal), await asegurarIcono(dir, exec.signal)]) if (p) pasos.push(p)
      } catch (e) { return `❌ ${e.message}` }
      const carpetaPrueba = path.join(dir, '.prueba')
      const r = await correrElectron(dir, ['.'], exec.signal, 120_000, { DSH_ESCRITORIO_PRUEBA: carpetaPrueba })
      let res = null
      try { res = JSON.parse(await readFile(path.join(carpetaPrueba, 'resultado.json'), 'utf8')) } catch {}
      if (!res) return `${pasos.join('\n')}\n❌ La app no arrancó:\n${finalDe(r.salida, 2500)}`
      const ok = !res.errores.length
      return [
        ...pasos,
        `${ok ? '✅' : '❌'} ${res.nombre} ${res.version} abrió${ok ? ' sin errores' : ' con problemas'} (${res.plataforma}). Título: "${res.titulo}".`,
        `Puente window.escritorio: ${res.puente ? 'sí' : 'NO'} · Bandeja: ${res.bandeja ? 'sí' : conf.bandeja ? 'NO' : 'desactivada'} · Atajo ${conf.atajo ?? '—'}: ${res.atajo === null ? '—' : res.atajo ? 'registrado' : 'NO se pudo registrar (¿lo usa otra app?)'}`,
        ...(res.errores.length ? ['Errores:', ...res.errores.slice(0, 8).map((e) => `- ${e}`)] : []),
        `Texto visible: ${res.texto.replace(/\s+/g, ' ').slice(0, 200) || '(vacío)'}`,
        `Capturas (míralas): ${res.capturas.map((c) => path.relative(cwd, c).split(path.sep).join('/')).join(', ')}`,
      ].join('\n')
    },
  })

  ctx.tools.register({
    name: 'escritorio_empaquetar',
    description: 'Crea el instalador de la app para este computador (Windows: .exe; Mac: .dmg; Linux: .AppImage) en escritorio/instaladores/. Para Windows y Mac a la vez usa escritorio_publicar (GitHub Actions).',
    timeoutMs: (DEFAULTS.minutosEmpaquetar + 22) * 60_000,
    parameters: { type: 'object', properties: { carpeta: { type: 'string' }, version: { type: 'string', description: 'Versión del instalador, ej. 1.0.1 (opcional)' } } },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { dir, rel } = dirApp(cwd, args?.carpeta)
      const conf = await leerConfig(dir)
      if (!conf) return `No hay app de escritorio en ${rel}/. Créala con escritorio_crear.`
      const pasos = []
      try { for (const p of [await instalarSiFalta(dir, exec.signal), await prepararInterfaz(dir, conf, exec.signal), await asegurarIcono(dir, exec.signal)]) if (p) pasos.push(p) } catch (e) { return `❌ ${e.message}` }
      if (args?.version) {
        if (!/^\d+\.\d+\.\d+$/.test(args.version)) throw new Error('"version" debe ser como 1.2.3')
        const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')); pkg.version = args.version
        await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
      }
      const plat = process.platform === 'win32' ? '--win' : process.platform === 'darwin' ? '--mac' : '--linux'
      const r = await correr(npx, ['electron-builder', plat, '--publish', 'never'], { cwd: dir, signal: exec.signal, timeoutMs: cfg.minutosEmpaquetar * 60_000, env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })
      if (r.codigo !== 0) return `${pasos.join('\n')}\n❌ Falló el empaquetado:\n${finalDe(r.salida, 3500)}`
      const out = path.join(dir, 'instaladores')
      const archivos = (await readdir(out)).filter((f) => /\.(exe|dmg|AppImage|zip|deb)$/i.test(f))
      const lista = await Promise.all(archivos.map(async (f) => `- ${rel}/instaladores/${f} (${await tamanoLegible(path.join(out, f))})`))
      return [
        ...pasos,
        `✅ Instalador listo para ${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux'}:`,
        ...lista,
        process.platform === 'win32' ? 'Al abrirlo, Windows puede mostrar "Windows protegió tu PC" porque no está firmado: Más información → Ejecutar de todas formas.' : '',
        'Para Windows y Mac a la vez, con actualizaciones automáticas: escritorio_publicar.',
      ].filter(Boolean).join('\n')
    },
  })

  ctx.tools.register({
    name: 'escritorio_publicar',
    description: 'Escribe el flujo de GitHub Actions que compila la app para Windows y Mac en los servidores de GitHub y publica los instaladores como versión (las apps instaladas se actualizan solas). No sube nada: devuelve los comandos para que el usuario apruebe el commit y la etiqueta.',
    parameters: { type: 'object', properties: { carpeta: { type: 'string' } } },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { dir, rel } = dirApp(cwd, args?.carpeta)
      const conf = await leerConfig(dir)
      if (!conf) return `No hay app de escritorio en ${rel}/. Créala con escritorio_crear.`
      const raiz = await raizGit(cwd)
      if (!raiz) return 'El proyecto no es un repositorio de git. Para compilar en GitHub, primero hay que subirlo a un repositorio (git init, git remote add origin …).'
      const gh = await repoGithub(raiz)
      const dirRel = path.relative(raiz, dir).split(path.sep).join('/') || '.'
      const webDirRel = conf.web ? path.relative(raiz, path.resolve(dir, conf.web.carpeta)).split(path.sep).join('/') : null
      const webConDeps = webDirRel !== null && existsSync(path.join(raiz, webDirRel, 'package.json')) ? (webDirRel || '.') : null
      const flujo = path.join(raiz, '.github', 'workflows', 'escritorio.yml')
      await mkdir(path.dirname(flujo), { recursive: true })
      await writeFile(flujo, flujoGithub({ dirRel, webDirRel: webConDeps, nombre: conf.nombre }))
      if (gh) {
        const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
        pkg.build.publish = [{ provider: 'github', owner: gh.owner, repo: gh.repo, releaseType: 'release' }]
        await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
      }
      return [
        `Flujo escrito: ${path.relative(cwd, flujo).split(path.sep).join('/')} (Windows y Mac en paralelo).`,
        gh ? `Repositorio: github.com/${gh.owner}/${gh.repo}` : 'Ojo: no encontré el repositorio de GitHub en .git/config; las actualizaciones automáticas necesitan uno.',
        '',
        'Para publicar una versión (pídele aprobación al usuario antes):',
        `  git add .github/workflows/escritorio.yml ${dirRel}`,
        '  git commit -m "App de escritorio"',
        '  git tag escritorio-v1.0.0',
        '  git push && git push --tags',
        `Luego, en github.com/${gh ? `${gh.owner}/${gh.repo}` : '<usuario>/<repo>'}/actions se ve la compilación (unos 10 minutos) y los instaladores quedan en Releases. Para una prueba sin publicar: pestaña Actions → Escritorio → Run workflow.`,
        'Si el repositorio es privado, las apps no podrán descargar actualizaciones sin un token: para uso interno conviene un repositorio aparte, público solo con los instaladores, o actualizar a mano.',
      ].join('\n')
    },
  })
}
