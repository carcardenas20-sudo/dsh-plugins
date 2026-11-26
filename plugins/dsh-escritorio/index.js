// dsh-escritorio — convierte la interfaz del proyecto en una app de escritorio para Windows y Mac
// (Electron): ventana con tamaño recordado, bandeja del sistema, atajo global, archivos del PC,
// notificaciones, arranque con el sistema, una sola instancia y actualizaciones automáticas.
// El agente la prueba abriéndola de verdad (capturas en claro y oscuro), la empaqueta como
// instalador y deja GitHub Actions compilando Windows y Mac a la vez.
// Además trae un motor de automatizaciones (robots de navegador, horarios, carpetas vigiladas,
// cambios en Supabase en tiempo real) que corre dentro de la app aunque la ventana esté cerrada.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'

export const name = 'escritorio'
export const inject = ['tools', 'workingDirectory', 'systemPrompt']

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const VERSIONES = { electron: '45.5.0', builder: '26.18.0', updater: '6.8.11', playwright: '1.65.1', supabase: '2.119.2', ws: '8.23.0' }
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

export function flujoGithub({ dirRel, webDirRel, nombre }) {
  const enDir = dirRel === '.' ? '' : `\n        working-directory: ${dirRel}`
  const sal = `${dirRel === '.' ? '' : `${dirRel}/`}instaladores`
  return `# Compila ${nombre} para Windows, Mac y Linux en los servidores de GitHub (generado por dsh-escritorio).
# Publicar una versión (las apps ya instaladas la descargan solas y se actualizan al cerrarse), de dos formas:
# - Desde la web: pestaña Actions → Escritorio → Run workflow → escribe la versión (ej. 1.2.0).
# - Con git: git tag escritorio-v1.2.0 && git push origin escritorio-v1.2.0
# - O en Releases → "Draft a new release" con la etiqueta escritorio-v1.2.0 (los instaladores se suben solos).
# "Run workflow" con la versión vacía solo compila (los instaladores quedan en esa ejecución).
name: Escritorio

on:
  push:
    tags: ['escritorio-v*']
  workflow_dispatch:
    inputs:
      version:
        description: 'Versión a publicar, ej. 1.2.0 (mayor que la anterior). Vacío = solo compilar.'
        required: false
        default: ''

env:
  VERSION: \${{ startsWith(github.ref, 'refs/tags/escritorio-v') && github.ref_name || inputs.version }}

permissions:
  contents: write

jobs:
  compilar:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
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
      - name: Versión
        if: env.VERSION != ''${enDir}
        shell: bash
        run: |
          V="\${VERSION#escritorio-v}"
          [[ "$V" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+$ ]] || { echo "::error::La versión debe ser como 1.2.0 (recibí '$V')"; exit 1; }
          npm pkg set version="$V"
      - name: Mac sin Spotlight (evita que el .dmg quede "ocupado")
        if: runner.os == 'macOS'
        run: sudo mdutil -a -i off
      - name: Instaladores${enDir}
        shell: bash
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
        run: |
          case "$RUNNER_OS" in Windows) P=--win;; macOS) P=--mac;; *) P=--linux;; esac
          npx electron-builder $P --publish never
      - uses: actions/upload-artifact@v4
        with:
          name: ${slug(nombre) || 'app'}-\${{ runner.os }}
          path: |
            ${sal}/*.exe
            ${sal}/*.dmg
            ${sal}/*.zip
            ${sal}/*.AppImage
            ${sal}/*.blockmap
            ${sal}/latest*.yml
          if-no-files-found: error

  publicar:
    # Solo con versión, y solo si las tres compilaciones salieron bien: así nunca queda una versión a medias.
    needs: compilar
    if: startsWith(github.ref, 'refs/tags/escritorio-v') || inputs.version != ''
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: salida
          merge-multiple: true
      - name: Versión en Releases
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          ls -la salida
          V="\${VERSION#escritorio-v}"
          T="escritorio-v$V"
          NOTAS="Instaladores de ${nombre} $V. Windows: .exe · Mac: .dmg · Linux: .AppImage. Las apps ya instaladas se actualizan solas."
          if gh release view "$T" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
            # La versión se creó a mano en Releases: se le suben los instaladores.
            gh release upload "$T" salida/* --repo "$GITHUB_REPOSITORY" --clobber
            gh release edit "$T" --repo "$GITHUB_REPOSITORY" --draft=false --prerelease=false --latest
          else
            gh release create "$T" salida/* --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" --title "${nombre} $V" --latest --notes "$NOTAS"
          fi
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
  '',
  '### Automations inside the desktop app',
  'The app has an automation engine that keeps running while the window is closed (tray). Each automation is escritorio/automatizaciones/<id>.js; create them with escritorio_automatizacion (it validates the trigger and code), then ALWAYS run escritorio_probar with soloAutomatizaciones:[id] and read the result, logs and robot screenshots before saying it works.',
  'Triggers ("cuando", one or a list): {cron:"0 18 * * 1-5"} (local time) · {cada:"15m", ya?:true} · {carpeta:"~/Documents/Entrada", archivos:"*.csv|*.xlsx"} · {tabla:"pagos", evento:"INSERT"|"UPDATE"|"DELETE"|"*", filtro?:"sede=eq.Norte"} (Supabase realtime) · {alIniciar:true} · {manual:true}. Options: tiempoMaximo ("10m" default), reintentos (backoff 30 s, 1 min…), ponerseAlDia (run once if the PC was off at the cron time), avisarError (default true), avisarExito, enPrueba:false (skip in tests, e.g. it sends real messages).',
  'ctx in ejecutar(ctx): disparo {tipo, datos, archivo, fila, anterior, hora} · config (= "variables" in escritorio.config.json) · registro(...) · progreso(%, texto) · notificar(titulo, cuerpo) · interfaz(evento, datos) → UI gets it via window.escritorio.automatizaciones.alEvento · ejecutar(otroId, datos) chains another automation · pausa("2s") · cancelado() · archivos {ruta, existe, leer(p,"texto"|"json"|"bytes"), escribir, agregar, listar(dir, patron), mover, copiar, crearCarpeta, csv(filas), leerCsv(texto), carpetaApp} (~ = user home) · estado {leer(k, def), guardar(k, v)} persisted per automation · db = Supabase client (needs escritorio_datos) · http = fetch.',
  'Robots: const p = await robot({ sesion?: "nombre", visible?: false, espera?: 30000 }) returns a Playwright Page using the browser already on the PC (Edge on Windows, Chrome on Mac/Linux; nothing to download). Use role/label locators (getByRole, getByLabel, getByText), never brittle CSS chains; wait for content before reading. p.descargar(() => click) saves a download and returns its path; p.captura("nombre") saves a screenshot shown in the panel. Errors automatically save a screenshot of every open page. A named sesion keeps cookies/logins between runs: prefer a one-time visible login (robot({sesion, visible:true}) and wait for the logged-in page) over storing passwords; if credentials are unavoidable put them in "variables", never in code, and tell the user they live inside the installed app.',
  'Each run happens in a separate process with a time limit, so a stuck robot never freezes the app. History (result, logs, screenshots) lives in the panel: tray → Automatizaciones, or window.escritorio.automatizaciones.abrirPanel(). From the UI: automatizaciones.lista/ejecutar(id, datos)/activar(id, bool)/cancelar/historial/alCambiar.',
  '',
  '### Real-time data',
  'escritorio_datos connects Supabase (url + public anon/publishable key only; it refuses service_role/secret keys) for both automations (ctx.db, {tabla} triggers) and the UI (it writes src/lib/datos-en-vivo.js: crearDatos({url, clave}).enVivo(tabla, opciones, alCambiar) with live updates and an offline cache, and guardar() that queues writes while offline). Remind the user to enable Row Level Security with policies, and to add tables to the supabase_realtime publication.',
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
  const requerir = createRequire(path.join(AQUI, 'plantilla', 'motor', 'cron.cjs'))
  const { parsearCron, duracion } = requerir('./cron.cjs')

  // Apps creadas con versiones anteriores del plugin: les agrega el motor y sus dependencias.
  async function asegurarMotor(dir) {
    const cambios = []
    if (!existsSync(path.join(dir, 'motor', 'motor.cjs'))) {
      for (const f of ['main.js', 'preload.js']) await cp(path.join(AQUI, 'plantilla', f), path.join(dir, f))
      await cp(path.join(AQUI, 'plantilla', 'motor'), path.join(dir, 'motor'), { recursive: true })
      cambios.push('motor de automatizaciones agregado (main.js y preload.js actualizados)')
    }
    const archivoPkg = path.join(dir, 'package.json')
    const pkg = JSON.parse(await readFile(archivoPkg, 'utf8'))
    let tocado = false
    const deps = { 'electron-updater': VERSIONES.updater, 'playwright-core': VERSIONES.playwright, '@supabase/supabase-js': VERSIONES.supabase, ws: VERSIONES.ws }
    for (const [k, v] of Object.entries(deps)) if (!pkg.dependencies?.[k]) { (pkg.dependencies ||= {})[k] = v; tocado = true }
    const mayor = (v) => Number(String(v || '0').replace(/^[^\d]*/, '').split('.')[0])
    if (mayor(pkg.devDependencies?.electron) < mayor(VERSIONES.electron)) { pkg.devDependencies.electron = VERSIONES.electron; pkg.devDependencies['electron-builder'] = VERSIONES.builder; tocado = true; cambios.push(`Electron actualizado a ${VERSIONES.electron}`) }
    for (const f of ['motor/**/*', 'automatizaciones/**/*']) if (pkg.build?.files && !pkg.build.files.includes(f)) { pkg.build.files.push(f); tocado = true }
    if (tocado) {
      await writeFile(archivoPkg, JSON.stringify(pkg, null, 2) + '\n')
      await rm(path.join(dir, 'node_modules', 'electron'), { recursive: true, force: true }) // fuerza npm install
      cambios.push('dependencias de robots y base de datos agregadas')
    }
    return cambios.length ? `Actualizada la app: ${cambios.join('; ')}.` : null
  }

  function validarCuando(cuando, conf) {
    const lista = cuando === undefined ? [{ manual: true }] : Array.isArray(cuando) ? cuando : [cuando]
    const avisos = []
    for (const d of lista) {
      if (!d || typeof d !== 'object') throw new Error('cada disparador debe ser un objeto, ej. { "cron": "0 18 * * 1-5" }')
      const claves = ['cron', 'cada', 'carpeta', 'tabla', 'alIniciar', 'manual'].filter((k) => d[k] !== undefined)
      if (claves.length !== 1) throw new Error(`disparador ambiguo o vacío: ${JSON.stringify(d)} (usa uno de cron, cada, carpeta, tabla, alIniciar, manual)`)
      if (d.cron) parsearCron(String(d.cron))
      if (d.cada && duracion(d.cada) < 10_000) throw new Error('"cada" debe ser de 10 segundos o más')
      if (d.carpeta && typeof d.carpeta !== 'string') throw new Error('"carpeta" debe ser una ruta, ej. "~/Documents/Entrada"')
      if (d.tabla && !conf.supabase?.url) avisos.push(`"tabla": ${d.tabla} necesita la base de datos: usa escritorio_datos`)
      if (d.evento && !['INSERT', 'UPDATE', 'DELETE', '*'].includes(String(d.evento).toUpperCase())) throw new Error('"evento" debe ser INSERT, UPDATE, DELETE o *')
    }
    return { lista, avisos }
  }

  const leerConfig = async (dir) => { try { return JSON.parse(await readFile(path.join(dir, 'escritorio.config.json'), 'utf8')) } catch { return null } }

  async function instalarSiFalta(dir, signal) {
    let necesarias = ['electron', 'electron-builder']
    try { const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')); necesarias = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }) } catch {}
    if (necesarias.every((d) => existsSync(path.join(dir, 'node_modules', ...d.split('/'))))) return null
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
    parameters: {
      type: 'object',
      properties: {
        carpeta: { type: 'string' },
        soloAutomatizaciones: { type: 'array', items: { type: 'string' }, description: 'Ids de automatizaciones a ejecutar en la prueba (por defecto todas menos las que digan enPrueba: false). ["ninguna"] para no ejecutar ninguna.' },
      },
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { dir, rel } = dirApp(cwd, args?.carpeta)
      const conf = await leerConfig(dir)
      if (!conf) return `No hay app de escritorio en ${rel}/. Créala con escritorio_crear.`
      const pasos = []
      const conAutos = existsSync(path.join(dir, 'automatizaciones'))
      if (conAutos) { try { const m = await asegurarMotor(dir); if (m) pasos.push(m) } catch (e) { return `❌ ${e.message}` } }
      try {
        for (const p of [await instalarSiFalta(dir, exec.signal), await prepararInterfaz(dir, conf, exec.signal), await asegurarIcono(dir, exec.signal)]) if (p) pasos.push(p)
      } catch (e) { return `❌ ${e.message}` }
      const carpetaPrueba = path.join(dir, '.prueba')
      const solo = Array.isArray(args?.soloAutomatizaciones) ? args.soloAutomatizaciones.map(String) : []
      const r = await correrElectron(dir, ['.'], exec.signal, conAutos ? 330_000 : 120_000, { DSH_ESCRITORIO_PRUEBA: carpetaPrueba, DSH_ESCRITORIO_PRUEBA_AUTOS: solo.join(',') })
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
        ...(res.automatizaciones ? ['', `Automatizaciones (${res.automatizaciones.length}):`, ...res.automatizaciones.map((a) => a.omitida ? `- ${a.id}: omitida en la prueba` : [
          `- ${a.ok ? '✅' : '❌'} ${a.id}${a.nombre ? ` "${a.nombre}"` : ''}${a.cuando ? ` [${a.cuando.join(' · ')}]` : ''}${a.ms != null ? ` en ${(a.ms / 1000).toFixed(1)} s` : ''}`,
          ...(a.error ? [`    error: ${a.error}`] : []),
          ...(a.resultado != null ? [`    resultado: ${JSON.stringify(a.resultado).slice(0, 400)}`] : []),
          ...(a.registros?.length ? [`    registro: ${a.registros.slice(-8).join(' | ').slice(0, 600)}`] : []),
          ...(a.capturas?.length ? [`    pantallas del robot (míralas): ${a.capturas.map((c) => path.relative(cwd, c).startsWith('..') ? c : path.relative(cwd, c)).join(', ')}`] : []),
        ].join('\n'))] : []),
        `Capturas (míralas): ${res.capturas.map((c) => path.relative(cwd, c).split(path.sep).join('/')).join(', ')}`,
      ].join('\n')
    },
  })

  ctx.tools.register({
    name: 'escritorio_automatizacion',
    description: 'Crea (o reemplaza) una automatización dentro de la app de escritorio: un robot de navegador, una tarea con horario, una carpeta vigilada, una reacción a cambios en Supabase, etc. Valida el disparador y el código y deja el archivo en escritorio/automatizaciones/<id>.js. Después pruébala con escritorio_probar { soloAutomatizaciones: [id] }.',
    timeoutMs: 60_000,
    parameters: {
      type: 'object',
      required: ['id', 'nombre', 'codigo'],
      properties: {
        carpeta: { type: 'string' },
        id: { type: 'string', description: 'Identificador corto en minúsculas, ej. "descargar-pagos".' },
        nombre: { type: 'string', description: 'Nombre visible en el panel, ej. "Descargar pagos de la plataforma".' },
        descripcion: { type: 'string', description: 'Una frase: qué hace y dónde deja el resultado.' },
        cuando: { description: 'Disparador u objeto o lista: {cron:"0 18 * * 1-5"} · {cada:"15m"} · {carpeta:"~/Documents/Entrada", archivos:"*.csv"} · {tabla:"pagos", evento:"INSERT"} · {alIniciar:true} · {manual:true}. Por defecto manual.' },
        codigo: { type: 'string', description: 'Cuerpo de async ejecutar(ctx), con estas variables disponibles: disparo, config, registro, progreso, notificar, interfaz, ejecutar, pausa, cancelado, archivos, estado, robot, db, http. Lo que devuelva queda como resultado en el historial.' },
        tiempoMaximo: { type: 'string', description: 'Ej. "5m" (por defecto 10m).' },
        reintentos: { type: 'number' },
        ponerseAlDia: { type: 'boolean', description: 'Con cron: si el PC estaba apagado a la hora, corre una vez al abrir.' },
        avisarExito: { type: 'boolean' },
        avisarError: { type: 'boolean' },
        enPrueba: { type: 'boolean', description: 'false si no debe correr en escritorio_probar (ej. envía mensajes reales).' },
        variables: { type: 'object', description: 'Valores para config (URLs, usuarios…): se guardan en "variables" de escritorio.config.json.' },
        reemplazar: { type: 'boolean', description: 'true para sobrescribir una automatización existente.' },
      },
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { dir, rel } = dirApp(cwd, args?.carpeta)
      const conf = await leerConfig(dir)
      if (!conf) return `No hay app de escritorio en ${rel}/. Créala primero con escritorio_crear.`
      const id = slug(args.id)
      if (!id) return '❌ "id" no es válido: usa letras, números y guiones.'
      let lista, avisos
      try { ({ lista, avisos } = validarCuando(args.cuando, conf)) } catch (e) { return `❌ Disparador inválido: ${e.message}` }
      const codigo = String(args.codigo || '')
      const variablesCtx = 'disparo, config, registro, progreso, notificar, interfaz, ejecutar, pausa, cancelado, archivos, estado, robot, db, http'
      try { new vm.Script(`(async function ejecutar({ ${variablesCtx} }) {\n${codigo}\n})`, { filename: `${id}.js` }) } catch (e) { return `❌ El código no compila: ${e.message}` }
      const archivo = path.join(dir, 'automatizaciones', `${id}.js`)
      if (existsSync(archivo) && !args.reemplazar) return `Ya existe automatizaciones/${id}.js. Pasa reemplazar: true para sobrescribirla, o usa otro id.`
      const opciones = {}
      for (const k of ['tiempoMaximo', 'reintentos', 'ponerseAlDia', 'avisarExito', 'avisarError', 'enPrueba']) if (args[k] !== undefined) opciones[k] = args[k]
      if (opciones.tiempoMaximo) { try { duracion(opciones.tiempoMaximo) } catch (e) { return `❌ ${e.message}` } }
      const js = (v) => JSON.stringify(v, null, 2).replace(/\n/g, '\n  ')
      const sangrado = codigo.split('\n').map((l) => (l.trim() ? `    ${l}` : '')).join('\n')
      const texto = [
        `// ${args.nombre}${args.descripcion ? ` — ${args.descripcion}` : ''}`,
        '// Generada con dsh-escritorio. Se ejecuta en un proceso aparte con tiempo máximo; ver el panel de Automatizaciones.',
        'module.exports = {',
        `  nombre: ${JSON.stringify(args.nombre)},`,
        ...(args.descripcion ? [`  descripcion: ${JSON.stringify(args.descripcion)},`] : []),
        `  cuando: ${js(lista.length === 1 ? lista[0] : lista)},`,
        ...Object.entries(opciones).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`),
        '',
        `  async ejecutar({ ${variablesCtx} }) {`,
        sangrado,
        '  },',
        '}',
        '',
      ].join('\n')
      await mkdir(path.dirname(archivo), { recursive: true })
      await writeFile(archivo, texto)
      if (args.variables && typeof args.variables === 'object') {
        conf.variables = { ...(conf.variables || {}), ...args.variables }
        await writeFile(path.join(dir, 'escritorio.config.json'), JSON.stringify(conf, null, 2) + '\n')
      }
      let mejora = null
      try { mejora = await asegurarMotor(dir) } catch (e) { return `❌ ${e.message}` }
      const usaRobot = /\brobot\s*\(/.test(codigo)
      return [
        `✅ ${rel}/automatizaciones/${id}.js — "${args.nombre}"`,
        ...(mejora ? [mejora] : []),
        ...avisos.map((a) => `⚠ ${a}`),
        ...(usaRobot && /\b(clave|password|contrase)/i.test(codigo + JSON.stringify(args.variables || {})) ? ['⚠ Usa credenciales: quedan dentro de la app instalada. Si se puede, cambia a una sesión con nombre e inicio de sesión manual la primera vez (robot({ sesion, visible: true })).'] : []),
        `Ahora pruébala: escritorio_probar { soloAutomatizaciones: ["${id}"] }. Revisa resultado, registro y pantallas del robot antes de decir que funciona.`,
      ].join('\n')
    },
  })

  ctx.tools.register({
    name: 'escritorio_datos',
    description: 'Conecta la app de escritorio (automatizaciones e interfaz) a Supabase con tiempo real: guarda url y clave pública en la configuración y escribe en el proyecto web src/lib/datos-en-vivo.js (lecturas en vivo, copia local sin internet y cola de escrituras). Rechaza claves secretas.',
    timeoutMs: 10 * 60_000,
    parameters: {
      type: 'object',
      required: ['url', 'clave'],
      properties: {
        carpeta: { type: 'string' },
        url: { type: 'string', description: 'URL del proyecto, ej. https://abcd.supabase.co' },
        clave: { type: 'string', description: 'Clave PÚBLICA: anon o publishable (sb_publishable_…). Nunca service_role ni sb_secret_.' },
        instalar: { type: 'boolean', description: 'Instala @supabase/supabase-js en el proyecto web (por defecto true).' },
      },
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { dir, rel } = dirApp(cwd, args?.carpeta)
      const conf = await leerConfig(dir)
      if (!conf) return `No hay app de escritorio en ${rel}/. Créala primero con escritorio_crear.`
      const url = String(args.url || '').trim().replace(/\/+$/, '')
      const clave = String(args.clave || '').trim()
      if (!/^https:\/\/[^\s/]+$/.test(url)) return '❌ La URL debe ser como https://abcd.supabase.co'
      if (/^sb_secret_/.test(clave)) return '❌ Esa es una clave SECRETA (sb_secret_…): no puede ir dentro de una app que se instala. Usa la publishable (sb_publishable_…) o la anon.'
      try {
        const carga = JSON.parse(Buffer.from(clave.split('.')[1] || '', 'base64url').toString('utf8'))
        if (carga.role === 'service_role') return '❌ Esa es la clave service_role: salta todos los permisos y cualquiera podría sacarla del instalador. Usa la clave anon (pública) y protege las tablas con Row Level Security.'
      } catch {}
      if (!/^sb_publishable_/.test(clave) && clave.split('.').length !== 3) return '❌ No parece una clave de Supabase. Cópiala de Project Settings → API (anon / publishable).'
      conf.supabase = { url, clave }
      await writeFile(path.join(dir, 'escritorio.config.json'), JSON.stringify(conf, null, 2) + '\n')
      const pasos = [`✅ ${rel}/escritorio.config.json: base de datos conectada para las automatizaciones (ctx.db y disparadores { tabla }).`]
      const mejora = await asegurarMotor(dir).catch(() => null)
      if (mejora) pasos.push(mejora)
      const web = conf.web?.carpeta ? path.resolve(dir, conf.web.carpeta) : null
      if (web && existsSync(path.join(web, 'package.json'))) {
        const destino = path.join(web, existsSync(path.join(web, 'src')) ? 'src/lib' : 'lib', 'datos-en-vivo.js')
        await mkdir(path.dirname(destino), { recursive: true })
        await cp(path.join(AQUI, 'web', 'datos-en-vivo.js'), destino)
        pasos.push(`✅ ${path.relative(cwd, destino).split(path.sep).join('/')}: crearDatos({ url, clave }) → enVivo(tabla, opciones, alCambiar), guardar(tabla, fila), borrar(tabla, id).`)
        if (args.instalar !== false) {
          const r = await correr(npm, ['install', '--no-audit', '--no-fund', `@supabase/supabase-js@${VERSIONES.supabase}`], { cwd: web, signal: exec.signal, timeoutMs: 8 * 60_000 })
          pasos.push(r.codigo === 0 ? '✅ @supabase/supabase-js instalado en el proyecto web.' : `⚠ No pude instalar @supabase/supabase-js: ${finalDe(r.salida, 600)}`)
        }
      } else pasos.push('La interfaz no es un proyecto web compilado: el archivo de datos en vivo no se copió.')
      pasos.push(
        'Falta en Supabase (díselo al usuario, con el SQL):',
        '1. Activar Row Level Security en cada tabla y crear políticas (ej. solo usuarios con sesión): alter table pagos enable row level security; create policy "con sesión" on pagos for all to authenticated using (true) with check (true);',
        '2. Activar tiempo real en las tablas que se escuchan: alter publication supabase_realtime add table pagos;',
        'En la interfaz, tras iniciar sesión con supabase.auth, las automatizaciones reciben la sesión solas (crearDatos la pasa a window.escritorio.automatizaciones.sesion).',
      )
      return pasos.join('\n')
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
        conf.publicacion = { owner: gh.owner, repo: gh.repo }
        conf.actualizaciones = true
        await writeFile(path.join(dir, 'escritorio.config.json'), JSON.stringify(conf, null, 2) + '\n')
      }
      return [
        `Flujo escrito: ${path.relative(cwd, flujo).split(path.sep).join('/')} (Windows, Mac y Linux en paralelo; publica solo si los tres salen bien).`,
        gh ? `Repositorio: github.com/${gh.owner}/${gh.repo}` : 'Ojo: no encontré el repositorio de GitHub en .git/config; las actualizaciones automáticas necesitan uno.',
        '',
        'Para publicar una versión (pídele aprobación al usuario antes):',
        `  git add .github/workflows/escritorio.yml ${dirRel}`,
        '  git commit -m "App de escritorio"',
        '  git tag escritorio-v1.0.0',
        '  git push && git push --tags',
        `Luego, en github.com/${gh ? `${gh.owner}/${gh.repo}` : '<usuario>/<repo>'}/actions se ve la compilación (unos 10 minutos) y los instaladores quedan en Releases. Para una prueba sin publicar: pestaña Actions → Escritorio → Run workflow.`,
        'Actualizaciones: Windows y Linux se actualizan solos (descargan en segundo plano e instalan al cerrar o con "Reiniciar y actualizar" en la bandeja). Mac sin certificado de Apple avisa y abre la descarga; con certificado (Developer ID) se pone "macFirmada": true y también se actualiza solo.',
        'Cada versión nueva necesita un número mayor: escritorio-v1.0.1, escritorio-v1.1.0…',
        'Si el repositorio es privado, las apps no podrán descargar actualizaciones sin un token: para uso interno conviene un repositorio aparte, público solo con los instaladores, o actualizar a mano.',
      ].join('\n')
    },
  })
}
