// dsh-escritorio — convierte la interfaz del proyecto en una app de escritorio para Windows y Mac
// (Electron): ventana con tamaño recordado, bandeja del sistema, atajo global, archivos del PC,
// notificaciones, arranque con el sistema, una sola instancia y actualizaciones automáticas.
// El agente la prueba abriéndola de verdad (capturas en claro y oscuro), la empaqueta como
// instalador y deja GitHub Actions compilando Windows y Mac a la vez.
// Además trae un motor de automatizaciones (robots de navegador, horarios, carpetas vigiladas,
// cambios en Supabase en tiempo real) que corre dentro de la app aunque la ventana esté cerrada.
//
// Módulos: lib/base.js (versiones, package.json de la app), lib/github.js (Actions y página de descargas),
// lib/textos.js (reglas para el modelo), lib/procesos.js (comandos), tablas.js (SQL de Supabase),
// plantilla/ (la app Electron: main, preload, motor de automatizaciones), web/ (datos en vivo e interfaz).

import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { ACCESOS, envolverMigracion, normalizarTablas, sqlDeCambios, sqlDeTablas } from './tablas.js'
import { AQUI, VERSIONES, DEFAULTS, slug, limpio, iniciales, validarAtajo, iconoSvg, paqueteApp } from './lib/base.js'
import { flujoGithub, paginaDescargas } from './lib/github.js'
import { PAGINA_INICIAL, LEEME, REGLAS } from './lib/textos.js'
import { correr, finalDe, npm, npx, raizGit, repoGithub, detectarWeb, tamanoLegible } from './lib/procesos.js'
import { TECNOLOGIAS, crearTauri, crearJava, juntarInstaladores, nombreBinario } from './lib/otras.js'

export { slug, validarAtajo, iconoSvg, paqueteApp, flujoGithub, paginaDescargas }

export const name = 'escritorio'
export const inject = ['tools', 'workingDirectory', 'systemPrompt']

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
    try { if ((JSON.parse(await readFile(path.join(dir, 'escritorio.config.json'), 'utf8')).tecnologia || 'electron') !== 'electron') return null } catch {}
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

  // ---------- Tauri (Rust) y JavaFX (Java) ----------
  const tecnologiaDe = (conf) => conf?.tecnologia || 'electron'
  const NOMBRE_TEC = { electron: 'Electron', tauri: 'Tauri (Rust)', java: 'JavaFX (Java)' }
  async function requisitos(tec, signal) {
    if (tec === 'tauri') {
      const r = await correr(process.platform === 'win32' ? 'cargo.exe' : 'cargo', ['--version'], { signal, timeoutMs: 30_000 }).catch(() => ({ codigo: 1 }))
      if (r.codigo === 0) return null
      return ['Falta Rust en este PC (Tauri compila con Rust). Instálalo una vez y vuelve a probar:',
        process.platform === 'win32' ? '- Windows: winget install Rustlang.Rustup y luego las "Herramientas de compilación de C++" de Visual Studio (winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"). Reinicia la terminal.'
          : process.platform === 'darwin' ? '- Mac: xcode-select --install y luego curl --proto "=https" -sSf https://sh.rustup.rs | sh'
          : '- Linux: curl --proto "=https" -sSf https://sh.rustup.rs | sh y las librerías: sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev',
        'Sin instalar nada aquí también se puede: escritorio_publicar compila los instaladores en GitHub.'].join('\n')
    }
    if (tec === 'java') {
      const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac') : (process.platform === 'win32' ? 'javac.exe' : 'javac')
      const r = await correr(java, ['-version'], { signal, timeoutMs: 30_000 }).catch(() => ({ codigo: 1, salida: '' }))
      const v = Number(String(r.salida || '').match(/javac (\d+)/)?.[1] || 0)
      if (r.codigo === 0 && v >= 21) return null
      return [r.codigo === 0 ? `Este PC tiene Java ${v}; la app necesita el JDK 21 o más nuevo.` : 'Falta el JDK de Java en este PC.',
        process.platform === 'win32' ? '- Windows: winget install Microsoft.OpenJDK.21 (reinicia la terminal)' : process.platform === 'darwin' ? '- Mac: brew install openjdk@21' : '- Linux: sudo apt install openjdk-21-jdk',
        'Para el instalador de Windows (.exe) también hace falta WiX 3: winget install WiXToolset.WiXToolset. O sin instalar nada: escritorio_publicar compila en GitHub.'].join('\n')
    }
    return null
  }
  async function binarioTauri(dir) {
    const conf = JSON.parse(await readFile(path.join(dir, 'src-tauri', 'tauri.conf.json'), 'utf8'))
    return path.join(dir, 'src-tauri', 'target', 'debug', (conf.mainBinaryName || 'app') + (process.platform === 'win32' ? '.exe' : ''))
  }
  async function probarOtra(dir, conf, args, signal, carpetaPrueba, pasos) {
    const tec = tecnologiaDe(conf)
    const falta = await requisitos(tec, signal)
    if (falta) return { error: falta }
    const p = await instalarSiFalta(dir, signal); if (p) pasos.push(p)
    const solo = Array.isArray(args?.soloAutomatizaciones) ? args.soloAutomatizaciones.map(String) : []
    const env = { DSH_ESCRITORIO_PRUEBA: carpetaPrueba, DSH_ESCRITORIO_PRUEBA_AUTOS: solo.join(','), ...(args?.secretos ? { DSH_ESCRITORIO_SECRETOS: JSON.stringify(args.secretos) } : {}) }
    await rm(carpetaPrueba, { recursive: true, force: true })
    const prep = await correr(process.execPath, ['scripts/preparar.cjs'], { cwd: dir, signal, timeoutMs: 15 * 60_000 })
    if (prep.codigo !== 0) return { error: `falló la preparación:\n${finalDe(prep.salida)}` }
    if (tec === 'tauri') {
      const primera = !existsSync(path.join(dir, 'src-tauri', 'target', 'debug'))
      const b = await correr(npx, ['tauri', 'build', '--debug', '--no-bundle', '--config', 'src-tauri/tauri.extra.json'], { cwd: dir, signal, timeoutMs: 40 * 60_000 })
      if (b.codigo !== 0) return { error: `no compiló (Rust):\n${finalDe(b.salida, 3500)}` }
      pasos.push(primera ? 'Compilada con Rust (la primera vez tarda varios minutos; las siguientes, segundos).' : 'Compilada con Rust.')
      const bin = await binarioTauri(dir)
      const linuxSinPantalla = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
      const r = linuxSinPantalla ? await correr('xvfb-run', ['-a', '-s', '-screen 0 1440x960x24', bin], { cwd: dir, signal, timeoutMs: 360_000, env }) : await correr(bin, [], { cwd: dir, signal, timeoutMs: 360_000, env })
      return { salida: r.salida }
    }
    const r = await correr(process.execPath, ['scripts/java.cjs', 'probar'], { cwd: dir, signal, timeoutMs: 20 * 60_000, env })
    pasos.push('Compilada con el JDK.')
    return { salida: r.salida }
  }
  function informePrueba(res, conf, pasos, cwd) {
    const ok = !res.errores.length
    return [
      ...pasos,
      `${ok ? '✅' : '❌'} ${res.nombre} ${res.version} abrió${ok ? ' sin errores' : ' con problemas'} (${res.plataforma}${res.tecnologia ? `, ${NOMBRE_TEC[res.tecnologia] || res.tecnologia}` : ''}). Título: "${res.titulo}".`,
      `Puente window.escritorio: ${res.puente ? 'sí' : 'NO'} · Bandeja: ${res.bandeja ? 'sí' : conf.bandeja ? 'no disponible en esta prueba' : 'desactivada'}${res.tecnologia && res.tecnologia !== 'electron' ? '' : ` · Atajo ${conf.atajo ?? '—'}: ${res.atajo === null ? '—' : res.atajo ? 'registrado' : 'NO se pudo registrar (¿lo usa otra app?)'}`}`,
      ...(res.errores.length ? ['Errores:', ...res.errores.slice(0, 8).map((e) => `- ${e}`)] : []),
      `Texto visible: ${String(res.texto || '').replace(/\s+/g, ' ').slice(0, 200) || '(vacío)'}`,
      ...(res.automatizaciones ? ['', `Automatizaciones (${res.automatizaciones.length}):`, ...res.automatizaciones.map((a) => a.omitida ? `- ${a.id}: omitida en la prueba` : [
        `- ${a.ok ? '✅' : '❌'} ${a.id}${a.nombre ? ` "${a.nombre}"` : ''}${a.cuando ? ` [${a.cuando.join(' · ')}]` : ''}${a.ms != null ? ` en ${(a.ms / 1000).toFixed(1)} s` : ''}`,
        ...(a.error ? [`    error: ${a.error}`] : []),
        ...(a.resultado != null ? [`    resultado: ${JSON.stringify(a.resultado).slice(0, 400)}`] : []),
        ...(a.registros?.length ? [`    registro: ${a.registros.slice(-8).join(' | ').slice(0, 600)}`] : []),
        ...(a.capturas?.length ? [`    pantallas del robot (míralas): ${a.capturas.map((c) => path.relative(cwd, c).startsWith('..') ? c : path.relative(cwd, c)).join(', ')}`] : []),
      ].join('\n'))] : []),
      res.capturas.length ? `Capturas (míralas): ${res.capturas.map((c) => path.relative(cwd, c).split(path.sep).join('/')).join(', ')}` : 'Sin capturas en este sistema (la verificación se hizo con el texto y los errores de la página).',
    ].join('\n')
  }

  ctx.tools.register({
    name: 'escritorio_crear',
    description: 'Crea la app de escritorio (Windows y Mac) en escritorio/, con Electron (por defecto), Tauri (Rust: instalador mucho más liviano, usa el navegador del sistema) o JavaFX (Java). Todas traen la misma interfaz web, automatizaciones, datos en vivo, sin internet y aviso de versiones: ventana que recuerda su tamaño, bandeja del sistema, atajo global, acceso a archivos del PC, notificaciones, arranque con el sistema, una sola instancia, actualizaciones automáticas e ícono. La interfaz puede ser el proyecto web (Vite/React: se compila solo), una carpeta con HTML ya hecho, una URL desplegada o una página inicial nueva.',
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
        tecnologia: { type: 'string', enum: TECNOLOGIAS, description: 'electron (por defecto; lo más probado, actualización automática completa) · tauri (Rust: instalador de ~10 MB más el motor si hay robots; necesita Rust para compilar en el PC, o GitHub) · java (JavaFX: necesita el JDK 21 para compilar; el instalador lleva su propio Java). Elige la que pida el usuario.' },
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
      const tec = TECNOLOGIAS.includes(args.tecnologia) ? args.tecnologia : 'electron'
      if (tec === 'java' && origen === 'url') throw new Error('La versión Java muestra la interfaz del propio proyecto; para una web ya publicada usa tecnologia "electron" o "tauri".')
      if (tec !== 'electron') { conf.tecnologia = tec; delete conf.atajo }
      await mkdir(dir, { recursive: true })
      const raiz = await raizGit(cwd)
      const github = raiz ? await repoGithub(raiz) : null
      const o = { nombre, paquete: slug(nombre) || 'app-escritorio', version: '1.0.0', id: conf.id, github, color, web: conf.web }
      if (tec === 'tauri') await crearTauri(dir, o)
      else if (tec === 'java') await crearJava(dir, o)
      else {
        await cp(path.join(AQUI, 'plantilla'), dir, { recursive: true })
        await writeFile(path.join(dir, 'package.json'), JSON.stringify(paqueteApp(o), null, 2) + '\n')
        await writeFile(path.join(dir, '.gitignore'), 'node_modules/\ninstaladores/\n' + (conf.web ? 'app/\n' : ''))
      }
      await mkdir(path.join(dir, 'build'), { recursive: true })
      await mkdir(path.join(dir, 'app'), { recursive: true })
      await writeFile(path.join(dir, 'escritorio.config.json'), JSON.stringify(conf, null, 2) + '\n')
      await writeFile(path.join(dir, 'build', 'icono.svg'), iconoSvg(nombre, color))
      if (origen === 'nueva') await writeFile(path.join(dir, 'app', 'index.html'), PAGINA_INICIAL({ nombre, color }))
      await writeFile(path.join(dir, 'LEEME.md'), LEEME({ ...o, tecnologia: tec }))
      if (tec !== 'electron') {
        const falta = await requisitos(tec, exec.signal)
        return [
          `Creada la app de escritorio "${nombre}" con ${NOMBRE_TEC[tec]} en ${rel}/ (interfaz: ${origen === 'proyecto' ? `proyecto web, se compila con "${conf.web.comando}"` : origen === 'carpeta' ? `carpeta ${path.relative(cwd, webDir) || '.'}` : origen === 'url' ? conf.url : 'página inicial nueva en app/index.html'}).`,
          `Trae lo mismo que la versión Electron: window.escritorio (archivos, notificaciones, arranque con el sistema), bandeja, una sola instancia, automatizaciones (con el Node que viaja en el instalador solo si hay robots), datos en vivo, modo sin internet, versión mínima y aviso de versión nueva desde la página de descargas (escritorio_sitio). No trae atajo global de teclado.`,
          tec === 'tauri' ? 'Estructura: src-tauri/ (Rust, src/main.rs), app/ (interfaz), automatizaciones/, motor/, puente.js.' : 'Estructura: src/main/java/escritorio/ (App.java, Servidor.java…), app/ (interfaz), automatizaciones/, motor/.',
          falta ? `\n⚠ Para probarla en este PC:\n${falta}` : `Siguiente: escritorio_probar (${tec === 'tauri' ? 'la primera compilación de Rust tarda unos 5-10 minutos' : 'descarga JavaFX la primera vez'}).`,
        ].join('\n')
      }
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
        secretos: { type: 'object', description: 'Valores de prueba para los datos privados, ej. { "descargar-pagos.clave": "demo123" }. Solo para esta prueba: no se guardan.' },
      },
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { dir, rel } = dirApp(cwd, args?.carpeta)
      const conf = await leerConfig(dir)
      if (!conf) return `No hay app de escritorio en ${rel}/. Créala con escritorio_crear.`
      const pasos = []
      if (tecnologiaDe(conf) !== 'electron') {
        const carpetaPrueba = path.join(dir, '.prueba')
        let r
        try { r = await probarOtra(dir, conf, args, exec.signal, carpetaPrueba, pasos) } catch (e) { return `❌ ${e.message}` }
        if (r.error) return `${pasos.join('\n')}\n❌ ${r.error}`
        let res = null
        try { res = JSON.parse(await readFile(path.join(carpetaPrueba, 'resultado.json'), 'utf8')) } catch {}
        if (!res) return `${pasos.join('\n')}\n❌ La app no arrancó:\n${finalDe(r.salida, 2500)}`
        return informePrueba({ capturas: [], ...res, titulo: res.titulo ?? '', errores: res.errores || [] }, conf, pasos, cwd)
      }
      const conAutos = existsSync(path.join(dir, 'automatizaciones'))
      if (conAutos) { try { const m = await asegurarMotor(dir); if (m) pasos.push(m) } catch (e) { return `❌ ${e.message}` } }
      try {
        for (const p of [await instalarSiFalta(dir, exec.signal), await prepararInterfaz(dir, conf, exec.signal), await asegurarIcono(dir, exec.signal)]) if (p) pasos.push(p)
      } catch (e) { return `❌ ${e.message}` }
      const carpetaPrueba = path.join(dir, '.prueba')
      const solo = Array.isArray(args?.soloAutomatizaciones) ? args.soloAutomatizaciones.map(String) : []
      const r = await correrElectron(dir, ['.'], exec.signal, conAutos ? 330_000 : 120_000, { DSH_ESCRITORIO_PRUEBA: carpetaPrueba, DSH_ESCRITORIO_PRUEBA_AUTOS: solo.join(','), ...(args?.secretos ? { DSH_ESCRITORIO_SECRETOS: JSON.stringify(args.secretos) } : {}) })
      let res = null
      try { res = JSON.parse(await readFile(path.join(carpetaPrueba, 'resultado.json'), 'utf8')) } catch {}
      if (!res) return `${pasos.join('\n')}\n❌ La app no arrancó:\n${finalDe(r.salida, 2500)}`
      return informePrueba(res, conf, pasos, cwd)
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
        correEn: { type: 'object', description: 'Con varios equipos: dónde se activan sus horarios/vigilantes, ej. { "sede": "Norte" }, { "rol": "admin" }, { "equipo": "CAJA-1" }.' },
        unaVez: { type: 'boolean', description: 'Con varios equipos, false para que una tarea programada corra en CADA equipo (por defecto corre en uno solo por turno).' },
        secretos: { type: 'array', items: { type: 'object', properties: { nombre: { type: 'string' }, etiqueta: { type: 'string' }, tipo: { type: 'string', enum: ['clave', 'texto'] } }, required: ['nombre'] }, description: 'Datos privados que cada equipo guarda cifrados desde el panel (usuario y clave de una plataforma…). En el código: await secreto("clave"). Nunca pongas claves en "variables" ni en el código.' },
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
      const variablesCtx = 'disparo, config, registro, progreso, notificar, interfaz, ejecutar, pausa, cancelado, archivos, estado, robot, db, http, secreto'
      try { new vm.Script(`(async function ejecutar({ ${variablesCtx} }) {\n${codigo}\n})`, { filename: `${id}.js` }) } catch (e) { return `❌ El código no compila: ${e.message}` }
      const archivo = path.join(dir, 'automatizaciones', `${id}.js`)
      if (existsSync(archivo) && !args.reemplazar) return `Ya existe automatizaciones/${id}.js. Pasa reemplazar: true para sobrescribirla, o usa otro id.`
      const opciones = {}
      for (const k of ['tiempoMaximo', 'reintentos', 'ponerseAlDia', 'avisarExito', 'avisarError', 'enPrueba', 'correEn', 'unaVez', 'secretos']) if (args[k] !== undefined) opciones[k] = args[k]
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
        ...(/\b(clave|password|contrase|token)/i.test(JSON.stringify(args.variables || {})) ? ['⚠ Hay algo que parece una clave en "variables": eso queda dentro del instalador. Muévelo a "secretos" y léelo con await secreto("nombre"); cada equipo lo guarda cifrado en el panel.'] : []),
        ...(args.secretos?.length ? [`Datos privados por equipo: ${args.secretos.map((s) => s.nombre).join(', ')}. En la prueba pásalos con escritorio_probar { secretos: { "${id}.${args.secretos[0].nombre}": "valor de prueba" } }; en cada PC se guardan en el panel → ${args.nombre} → Datos privados.`] : []),
        `Ahora pruébala: escritorio_probar { soloAutomatizaciones: ["${id}"] }. Revisa resultado, registro y pantallas del robot antes de decir que funciona.`,
      ].join('\n')
    },
  })

  ctx.tools.register({
    name: 'escritorio_datos',
    description: 'Conecta la app de escritorio (automatizaciones e interfaz) a Supabase con tiempo real para varios equipos a la vez: guarda url y clave pública, genera el SQL de las tablas con permisos por fila (todos con sesión, cada quien lo suyo, por sede/área según el perfil, o solo lectura), perfiles con rol admin/usuario y tiempo real activado; copia al proyecto web datos-en-vivo.js (lecturas en vivo, copia local, cola sin internet, sesión) y escritorio-ui.js (pantalla de inicio de sesión, usuario y estado de conexión). Puede aplicar el SQL en Supabase si el PC tiene SUPABASE_ACCESS_TOKEN. Rechaza claves secretas.',
    timeoutMs: 10 * 60_000,
    parameters: {
      type: 'object',
      properties: {
        carpeta: { type: 'string' },
        url: { type: 'string', description: 'URL del proyecto, ej. https://abcd.supabase.co (no hace falta si ya está configurada).' },
        clave: { type: 'string', description: 'Clave PÚBLICA: anon o publishable (sb_publishable_…). Nunca service_role ni sb_secret_.' },
        tablas: {
          type: 'array',
          description: 'Tablas a crear o completar. Se agregan solas: id, creado_por, creado, actualizado.',
          items: {
            type: 'object',
            required: ['nombre', 'columnas'],
            properties: {
              nombre: { type: 'string' },
              acceso: { type: 'string', enum: ACCESOS, description: 'autenticados: cualquiera con sesión · propietario: cada quien sus filas (admin todo) · por-columna: filas de su sede/área según su perfil (admin todo) · solo-lectura: todos leen, solo admin escribe.' },
              columnaAcceso: { type: 'string', description: 'Con por-columna: la columna que se compara con el perfil (por defecto "sede").' },
              columnas: {
                type: 'array',
                items: {
                  type: 'object', required: ['nombre'],
                  properties: {
                    nombre: { type: 'string' }, tipo: { type: 'string', enum: ['texto', 'numero', 'entero', 'dinero', 'fecha', 'fechahora', 'booleano', 'json', 'uuid', 'correo', 'telefono'] },
                    requerido: { type: 'boolean' }, unico: { type: 'boolean' }, defecto: { description: 'Valor por defecto; "ahora" para fechas.' },
                    referencia: { type: 'string', description: 'Otra tabla de esta lista a la que apunta.' }, opciones: { type: 'array', items: { type: 'string' }, description: 'Valores permitidos.' },
                  },
                },
              },
            },
          },
        },
        roles: {
          type: 'array',
          description: 'Roles además de admin (que siempre existe y lo puede todo). Sin roles, se crea "usuario" con permisos según el acceso de cada tabla. El admin los puede cambiar después desde la app.',
          items: {
            type: 'object', required: ['nombre'],
            properties: {
              nombre: { type: 'string' }, descripcion: { type: 'string' },
              permisos: { type: 'object', description: '{ "<tabla>": { "acciones": ["leer","crear","cambiar","borrar"], "alcance": "todo" | "sede" | "propio" } }. "sede" = la columnaAcceso de la tabla igual a la del perfil.' },
              automatizaciones: { type: 'array', items: { type: 'string' }, description: 'Ids de automatizaciones que puede ejecutar, o ["*"].' },
              gestionaUsuarios: { type: 'boolean', description: 'Puede crear y administrar usuarios (no administradores).' },
            },
          },
        },
        valores: { type: 'object', description: 'Opciones fijas de los campos del perfil para la pantalla de usuarios, ej. { "sede": ["Norte", "Sur"] }.' },
        cambios: {
          type: 'array',
          description: 'Cambios que no son "agregar": renombrar o quitar columnas/tablas, cambiar tipos. Van en su propia migración ANTES del estado de las tablas. Quitar exige confirmar:true (deja copia en respaldo_*). Pasa en "tablas" ya el estado nuevo (con los nombres nuevos).',
          items: { type: 'object', required: ['tipo'], properties: { tipo: { type: 'string', enum: ['renombrar-columna', 'renombrar-tabla', 'cambiar-tipo', 'quitar-columna', 'quitar-tabla', 'sql'] }, tabla: { type: 'string' }, columna: { type: 'string' }, de: { type: 'string' }, a: { type: 'string' }, nuevoTipo: { type: 'string' }, confirmar: { type: 'boolean' }, descripcion: { type: 'string' }, sql: { type: 'string' } } },
        },
        copias: { type: 'boolean', description: 'false para no crear la automatización de copia de seguridad diaria de la base (por defecto se crea).' },
        aplicar: { type: 'boolean', description: 'true para ejecutar el SQL y publicar la función de usuarios en Supabase ahora (necesita la variable SUPABASE_ACCESS_TOKEN en el PC). Si no, quedan los archivos para pegarlos.' },
        titulo: { type: 'string', description: 'Título de la pantalla de inicio de sesión (por defecto el nombre de la app).' },
        registro: { type: 'boolean', description: 'true para permitir que la gente cree su propia cuenta (por defecto solo entra quien el admin crea).' },
        instalar: { type: 'boolean', description: 'Instala @supabase/supabase-js en el proyecto web (por defecto true).' },
      },
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { dir, rel } = dirApp(cwd, args?.carpeta)
      const conf = await leerConfig(dir)
      if (!conf) return `No hay app de escritorio en ${rel}/. Créala primero con escritorio_crear.`
      const url = String(args.url || conf.supabase?.url || '').trim().replace(/\/+$/, '')
      const clave = String(args.clave || conf.supabase?.clave || '').trim()
      if (!url || !clave) return '❌ Falta url y clave de Supabase (Project Settings → API).'
      if (!/^https:\/\/[^\s/]+$/.test(url)) return '❌ La URL debe ser como https://abcd.supabase.co'
      if (/^sb_secret_/.test(clave)) return '❌ Esa es una clave SECRETA (sb_secret_…): no puede ir dentro de una app que se instala. Usa la publishable (sb_publishable_…) o la anon.'
      try {
        const carga = JSON.parse(Buffer.from(clave.split('.')[1] || '', 'base64url').toString('utf8'))
        if (carga.role === 'service_role') return '❌ Esa es la clave service_role: salta todos los permisos y cualquiera podría sacarla del instalador. Usa la clave anon (pública) y protege las tablas con Row Level Security.'
      } catch {}
      if (!/^sb_publishable_/.test(clave) && clave.split('.').length !== 3) return '❌ No parece una clave de Supabase. Cópiala de Project Settings → API (anon / publishable).'

      let sql = null
      if (args.roles && !args.tablas) return '❌ Para definir roles pasa también "tablas" (los permisos se dan sobre ellas).'
      let sqlCambios = null
      if (args.cambios) { try { sqlCambios = sqlDeCambios(args.cambios) } catch (e) { return `❌ Cambios: ${e.message}` } }
      let tablasNorm = null
      if (args.tablas) { try { sql = sqlDeTablas(args.tablas, { roles: args.roles }); tablasNorm = normalizarTablas(args.tablas) } catch (e) { return `❌ ${args.roles ? 'Tablas o roles' : 'Tablas'}: ${e.message}` } }

      conf.supabase = { url, clave }
      await writeFile(path.join(dir, 'escritorio.config.json'), JSON.stringify(conf, null, 2) + '\n')
      const pasos = [`✅ ${rel}/escritorio.config.json: base de datos conectada para las automatizaciones (ctx.db y disparadores { tabla }).`]
      const mejora = await asegurarMotor(dir).catch(() => null)
      if (mejora) pasos.push(mejora)

      const web = conf.web?.carpeta ? path.resolve(dir, conf.web.carpeta) : null
      if (web && existsSync(path.join(web, 'package.json'))) {
        const carpetaLib = path.join(web, existsSync(path.join(web, 'src')) ? 'src/lib' : 'lib')
        await mkdir(carpetaLib, { recursive: true })
        await cp(path.join(AQUI, 'web', 'datos-en-vivo.js'), path.join(carpetaLib, 'datos-en-vivo.js'))
        await cp(path.join(AQUI, 'web', 'escritorio-ui.js'), path.join(carpetaLib, 'escritorio-ui.js'))
        const relLib = path.relative(cwd, carpetaLib).split(path.sep).join('/')
        const archivoDatos = path.join(carpetaLib, 'datos.js')
        let anterior = null
        try { anterior = (await readFile(archivoDatos, 'utf8')).match(/\/\/ UI: (.*)$/m)?.[1] } catch {}
        const ui = { titulo: args.titulo || conf.nombre || 'Bienvenido', subtitulo: 'Inicia sesión para continuar', registro: args.registro === true, ...(anterior ? JSON.parse(anterior) : {}) }
        if (args.titulo) ui.titulo = args.titulo
        if (args.registro !== undefined) ui.registro = args.registro === true
        if (tablasNorm) { ui.tablas = tablasNorm.map((x) => ({ nombre: x.nombre, sede: x.columnaAcceso || undefined })); ui.camposPerfil = sql.columnasPerfil }
        if (args.valores) ui.valores = args.valores
        await writeFile(archivoDatos, [
          '// Conexión única de la app a la base de datos (generado por dsh-escritorio; se reescribe al usar escritorio_datos).',
          "import { crearDatos } from './datos-en-vivo.js'",
          "import { conectarUI } from './escritorio-ui.js'",
          '',
          '// Clave PÚBLICA: lo que cada usuario ve lo deciden los roles y permisos por fila en Supabase.',
          `export const datos = crearDatos({ url: ${JSON.stringify(url)}, clave: ${JSON.stringify(clave)} })`,
          `// UI: ${JSON.stringify(ui)}`,
          `conectarUI(datos, ${JSON.stringify(ui, null, 2)})`,
          '',
        ].join('\n'))
        pasos.push(
          `✅ ${relLib}/datos.js (importa esto una vez, al inicio de la app), datos-en-vivo.js y escritorio-ui.js:`,
          '   - Envuelve TODA la interfaz en <acceso-escritorio>…</acceso-escritorio>: muestra el inicio de sesión hasta que haya sesión.',
          '   - Pon <estado-conexion></estado-conexion> y <usuario-escritorio></usuario-escritorio> en la barra superior.',
          "   - Lee y escribe con datos.enVivo('tabla', opciones, (filas) => …) y datos.guardar('tabla', fila); en React: useEffect(() => datos.enVivo('pagos', {}, setPagos), []).",
          '   - Permisos en la interfaz: datos.sesion.puede(tabla, "crear"|"cambiar"|"borrar") y datos.sesion.gestionaUsuarios() para mostrar u ocultar botones (la base de datos decide de verdad).',
          '   - Pantalla de administración: agrega una sección "Usuarios" visible solo si datos.sesion.gestionaUsuarios() con <admin-usuarios></admin-usuarios> (crear usuarios, roles, permisos por tabla y por automatización, actividad de todos los equipos).',
        )
        if (args.instalar !== false) {
          const r = await correr(npm, ['install', '--no-audit', '--no-fund', `@supabase/supabase-js@${VERSIONES.supabase}`], { cwd: web, signal: exec.signal, timeoutMs: 8 * 60_000 })
          pasos.push(r.codigo === 0 ? '✅ @supabase/supabase-js instalado en el proyecto web.' : `⚠ No pude instalar @supabase/supabase-js: ${finalDe(r.salida, 600)}`)
        }
      } else pasos.push('La interfaz no es un proyecto web compilado: los archivos de datos y de inicio de sesión no se copiaron.')

      if (sql || sqlCambios) {
        // ---- migraciones numeradas: cada una se aplica una sola vez y queda en public.migraciones ----
        const dirMig = path.join(cwd, 'supabase', 'migraciones')
        await mkdir(dirMig, { recursive: true })
        const existentes = (await readdir(dirMig)).filter((n) => /^\d{3}_[\w-]+\.sql$/.test(n)).sort()
        let siguiente = existentes.length ? Number(existentes.at(-1).slice(0, 3)) + 1 : 1
        const nuevas = []
        const nombreMig = (desc) => `${String(siguiente++).padStart(3, '0')}_${desc}`
        if (sqlCambios) {
          const n = nombreMig('cambios')
          await writeFile(path.join(dirMig, `${n}.sql`), envolverMigracion(n, sqlCambios.sql, sqlCambios.resumen))
          nuevas.push(`${n}.sql (${sqlCambios.resumen})`)
        }
        if (sql) {
          const huella = createHash('sha256').update(sql.sql).digest('hex').slice(0, 16)
          let ultimaHuella = null
          for (const n of [...existentes].reverse()) { const c = await readFile(path.join(dirMig, n), 'utf8'); const m = c.match(/^-- huella: (\w+)/m); if (m) { ultimaHuella = m[1]; break } }
          if (huella !== ultimaHuella) {
            const n = nombreMig(existentes.length || sqlCambios ? 'tablas' : 'inicio')
            const resumen = `tablas ${sql.tablas.join(', ')}; roles ${sql.roles.join(', ')}`
            await writeFile(path.join(dirMig, `${n}.sql`), `-- huella: ${huella}\n${envolverMigracion(n, sql.sql, resumen)}`)
            nuevas.push(`${n}.sql (${resumen})`)
          }
        }
        const todas = (await readdir(dirMig)).filter((n) => /^\d{3}_[\w-]+\.sql$/.test(n)).sort()
        const archivoSql = path.join(cwd, 'supabase', 'aplicar-todo.sql')
        await writeFile(archivoSql, ['-- Todas las migraciones en orden (generado por dsh-escritorio). Pégalo completo en Supabase → SQL Editor → Run:', '-- las ya aplicadas se saltan solas, así que siempre se puede correr entero.', '', ...(await Promise.all(todas.map((n) => readFile(path.join(dirMig, n), 'utf8'))))].join('\n'))
        const relSql = path.relative(cwd, archivoSql).split(path.sep).join('/')
        pasos.push(nuevas.length ? `✅ Migraciones nuevas en supabase/migraciones/: ${nuevas.join(' · ')}.` : '✅ Las tablas no cambiaron: no hace falta migración nueva.')
        pasos.push(`✅ ${relSql}: todas las migraciones (${todas.length}) en orden, para pegar de una vez.`)
        if (sql && args.copias !== false && existsSync(path.join(dir, 'automatizaciones')) === false) await mkdir(path.join(dir, 'automatizaciones'), { recursive: true })
        if (sql && args.copias !== false && !existsSync(path.join(dir, 'automatizaciones', 'copia-de-seguridad.js'))) {
          await writeFile(path.join(dir, 'automatizaciones', 'copia-de-seguridad.js'), automatizacionCopias(conf.nombre || 'App', [...sql.tablas, 'perfiles', 'roles', 'app_config']))
          pasos.push(`✅ ${rel}/automatizaciones/copia-de-seguridad.js: cada día a las 8 pm el equipo del administrador guarda todas las tablas en Documentos/${conf.nombre || 'App'}/Copias (JSON y CSV, últimas 30).`)
          await asegurarMotor(dir).catch(() => {})
        }
        let archivoFuncion = null, relFuncion = null
        if (sql) {
          archivoFuncion = path.join(cwd, 'supabase', 'functions', 'gestionar-usuarios', 'index.ts')
          await mkdir(path.dirname(archivoFuncion), { recursive: true })
          await cp(path.join(AQUI, 'web', 'funcion-usuarios.ts'), archivoFuncion)
          relFuncion = path.relative(cwd, archivoFuncion).split(path.sep).join('/')
          pasos.push(`✅ ${relFuncion}: función del servidor que crea y administra usuarios (la clave secreta queda solo en Supabase). Roles: ${sql.roles.join(', ')}.`)
        }
        const token = process.env.SUPABASE_ACCESS_TOKEN
        const ref = new URL(url).hostname.split('.')[0]
        let aplicadoSql = false, aplicadaFuncion = false
        if (args.aplicar && token && /\.supabase\.co$/.test(new URL(url).hostname)) {
          const consulta = async (query) => { const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: exec.signal }); const cuerpo = await r.text(); if (!r.ok) throw new Error(`(${r.status}) ${cuerpo.slice(0, 600)}`); try { return JSON.parse(cuerpo) } catch { return cuerpo } }
          try {
            let aplicadas = []
            try { aplicadas = (await consulta("select nombre from public.migraciones")).map((f) => f.nombre) } catch {}
            const pendientes = todas.filter((n) => !aplicadas.includes(n.replace(/\.sql$/, '')))
            for (const n of pendientes) { await consulta(await readFile(path.join(dirMig, n), 'utf8')); pasos.push(`✅ Aplicada ${n}`) }
            if (!pendientes.length) pasos.push('✅ La base ya tenía todas las migraciones.')
            aplicadoSql = true
          } catch (e) { pasos.push(`❌ Supabase rechazó una migración ${e.message}. Revisa y pega ${relSql} en el SQL Editor.`) }
          if (archivoFuncion) try {
            const form = new FormData()
            form.append('metadata', JSON.stringify({ name: 'gestionar-usuarios', entrypoint_path: 'index.ts', verify_jwt: true }))
            form.append('file', new Blob([await readFile(archivoFuncion)], { type: 'application/typescript' }), 'index.ts')
            const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=gestionar-usuarios`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: exec.signal })
            aplicadaFuncion = r.ok
            pasos.push(r.ok ? '✅ Función gestionar-usuarios publicada en Supabase.' : `❌ Supabase rechazó la función (${r.status}): ${(await r.text()).slice(0, 500)}`)
          } catch (e) { pasos.push(`❌ No pude publicar la función: ${e.message}`) }
        }
        if (!aplicadoSql) pasos.push(`Falta el SQL: ${args.aplicar && !token ? 'no hay SUPABASE_ACCESS_TOKEN en este PC, así que ' : ''}abre Supabase → SQL Editor, pega ${relSql} y dale Run (se puede repetir sin problema).`)
        if (archivoFuncion && !aplicadaFuncion) pasos.push(`Falta la función: Supabase → Edge Functions → Deploy a new function → "Via Editor", nombre gestionar-usuarios, pega ${relFuncion} y Deploy (o con la CLI: supabase functions deploy gestionar-usuarios).`)
        if (sql) pasos.push(
          'Después, díselo al usuario paso a paso:',
          '1. Authentication → Users → Add user: crea SOLO tu usuario (el del administrador).',
          "2. En el SQL Editor: update public.perfiles set rol = 'admin' where correo = 'tu@correo.com';",
          '3. Entra a la app con ese usuario: desde "Usuarios" creas a los demás, con su rol y sede, y ajustas permisos por rol y por automatización.',
          ...(args.registro ? [] : ['4. Authentication → Sign In / Providers: desactiva "Allow new users to sign up" para que solo entren los usuarios creados.']),
        )
        if (sqlCambios) pasos.push('⚠ Antes de aplicar cambios que renombran o quitan cosas, sube la versión mínima de la app (pestaña Sistema o escritorio_empaquetar { minima }) para que los equipos con la versión vieja no sigan escribiendo con los nombres viejos.')
      } else {
        pasos.push('Sin "tablas": si las tablas ya existen, verifica que tengan Row Level Security con políticas y estén en la publicación supabase_realtime. Pasa "tablas" para que genere ese SQL.')
      }
      return pasos.join('\n')
    },
  })

  ctx.tools.register({
    name: 'escritorio_empaquetar',
    description: 'Crea el instalador de la app para este computador (Windows: .exe; Mac: .dmg; Linux: .AppImage) en escritorio/instaladores/. Para Windows y Mac a la vez usa escritorio_publicar (GitHub Actions).',
    timeoutMs: (DEFAULTS.minutosEmpaquetar + 22) * 60_000,
    parameters: { type: 'object', properties: { carpeta: { type: 'string' }, version: { type: 'string', description: 'Versión del instalador, ej. 1.0.1 (opcional)' }, notas: { type: 'string', description: 'Novedades de esta versión, para la página de descargas.' }, minima: { type: 'string', description: 'Versión mínima obligatoria, ej. 1.3.0: los equipos con una menor se bloquean y piden actualizar (úsala cuando cambies la base de datos).' } } },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { dir, rel } = dirApp(cwd, args?.carpeta)
      const conf = await leerConfig(dir)
      if (!conf) return `No hay app de escritorio en ${rel}/. Créala con escritorio_crear.`
      const pasos = []
      const tec = tecnologiaDe(conf)
      if (args?.version) {
        if (!/^\d+\.\d+\.\d+$/.test(args.version)) throw new Error('"version" debe ser como 1.2.3')
        const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')); pkg.version = args.version
        await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
      }
      const version = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')).version
      const out = path.join(dir, 'instaladores')
      let archivos
      if (tec !== 'electron') {
        const falta = await requisitos(tec, exec.signal)
        if (falta) return `❌ ${falta}`
        try { const p = await instalarSiFalta(dir, exec.signal); if (p) pasos.push(p) } catch (e) { return `❌ ${e.message}` }
        const prep = await correr(process.execPath, ['scripts/preparar.cjs'], { cwd: dir, signal: exec.signal, timeoutMs: 15 * 60_000 })
        if (prep.codigo !== 0) return `❌ Falló la preparación:\n${finalDe(prep.salida, 2500)}`
        const bundles = process.platform === 'win32' ? 'nsis' : process.platform === 'darwin' ? 'dmg' : 'appimage,deb'
        const r = tec === 'tauri'
          ? await correr(npx, ['tauri', 'build', '--config', 'src-tauri/tauri.extra.json', '--bundles', bundles], { cwd: dir, signal: exec.signal, timeoutMs: 45 * 60_000 })
          : await correr(process.execPath, ['scripts/java.cjs', 'empaquetar'], { cwd: dir, signal: exec.signal, timeoutMs: 30 * 60_000 })
        if (r.codigo !== 0) return `${pasos.join('\n')}\n❌ Falló el empaquetado:\n${finalDe(r.salida, 3500)}`
        archivos = (await juntarInstaladores(dir, tec, version)).map((x) => x.archivo)
      } else {
        try { for (const p of [await instalarSiFalta(dir, exec.signal), await prepararInterfaz(dir, conf, exec.signal), await asegurarIcono(dir, exec.signal)]) if (p) pasos.push(p) } catch (e) { return `❌ ${e.message}` }
        const plat = process.platform === 'win32' ? '--win' : process.platform === 'darwin' ? '--mac' : '--linux'
        const r = await correr(npx, ['electron-builder', plat, '--publish', 'never'], { cwd: dir, signal: exec.signal, timeoutMs: cfg.minutosEmpaquetar * 60_000, env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })
        if (r.codigo !== 0) return `${pasos.join('\n')}\n❌ Falló el empaquetado:\n${finalDe(r.salida, 3500)}`
        archivos = (await readdir(out)).filter((f) => /\.(exe|dmg|AppImage|zip|deb)$/i.test(f))
      }
      const lista = await Promise.all(archivos.map(async (f) => `- ${rel}/instaladores/${f} (${await tamanoLegible(path.join(out, f))})`))
      let sitio = null
      if (conf.sitio) {
        await asegurarScriptsSitio(dir)
        const s = await correr(process.execPath, [path.join(dir, 'scripts', 'armar-sitio.cjs'), '--desde', out, '--salida', path.join(dir, 'sitio'), ...(args?.notas ? ['--notas', args.notas] : []), ...(args?.minima ? ['--minima', args.minima] : [])], { cwd: dir, signal: exec.signal, timeoutMs: 5 * 60_000 })
        sitio = s.codigo === 0 ? `✅ Sitio de descargas actualizado en ${rel}/sitio/: súbelo completo a ${conf.sitio} (reemplazando lo anterior). Las apps instaladas verán la versión nueva y avisarán.` : `⚠ No pude armar el sitio: ${finalDe(s.salida, 600)}`
      }
      return [
        ...pasos,
        `✅ Instalador listo para ${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux'}:`,
        ...lista,
        process.platform === 'win32' ? 'Al abrirlo, Windows puede mostrar "Windows protegió tu PC" porque no está firmado: Más información → Ejecutar de todas formas.' : '',
        ...(sitio ? [sitio, process.platform === 'win32' ? 'Este sitio solo trae el instalador de Windows; para Mac hace falta compilar en un Mac o con escritorio_publicar (GitHub Actions).' : ''] : ['Para Windows y Mac a la vez: escritorio_publicar. Para que los clientes descarguen desde su propia página: escritorio_sitio.']),
      ].filter(Boolean).join('\n')
    },
  })

  function automatizacionCopias(nombreApp, tablas) {
    const carpeta = `~/Documents/${String(nombreApp).replace(/[\\/:*?"<>|]+/g, '-')}/Copias`
    return `// Copia de seguridad diaria de la base (generada por dsh-escritorio). Corre en el equipo del administrador.
module.exports = {
  nombre: 'Copia de seguridad de la base',
  descripcion: 'Cada día a las 8 pm guarda todas las tablas en ${carpeta.slice(2)} (JSON y CSV) y conserva las últimas 30 copias.',
  cuando: { cron: '0 20 * * *' },
  ponerseAlDia: true, // si el PC estaba apagado a las 8 pm, la hace al abrir
  correEn: { rol: 'admin' }, // el administrador ve todas las filas
  tiempoMaximo: '20m',
  reintentos: 2,
  enPrueba: false,

  async ejecutar({ db, archivos, registro, progreso }) {
    const tablas = ${JSON.stringify(tablas)}
    const dia = new Date().toISOString().slice(0, 10)
    const carpeta = \`${carpeta}/\${dia}\`
    const resumen = {}
    for (const [i, t] of tablas.entries()) {
      progreso((i / tablas.length) * 100, t)
      const filas = []
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await db.from(t).select('*').range(desde, desde + 999)
        if (error) throw new Error(\`\${t}: \${error.message}\`)
        filas.push(...data)
        if (data.length < 1000) break
      }
      archivos.escribir(\`\${carpeta}/\${t}.json\`, JSON.stringify(filas, null, 1))
      if (filas.length) archivos.escribir(\`\${carpeta}/\${t}.csv\`, archivos.csv(filas.map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : v])))))
      resumen[t] = filas.length
    }
    const viejas = archivos.listar('${carpeta}', '????-??-??').sort().slice(0, -30)
    for (const v of viejas) require('node:fs').rmSync(v, { recursive: true, force: true })
    registro(\`copia en \${archivos.ruta(carpeta)}\`)
    return { carpeta: archivos.ruta(carpeta), filas: resumen, borradasViejas: viejas.length }
  },
}
`
  }

  async function asegurarScriptsSitio(dir) {
    await mkdir(path.join(dir, 'scripts'), { recursive: true })
    for (const f of ['armar-sitio.cjs', 'pagina-descargas.html']) if (!existsSync(path.join(dir, 'scripts', f))) await cp(path.join(AQUI, 'plantilla', 'scripts', f), path.join(dir, 'scripts', f))
  }

  ctx.tools.register({
    name: 'escritorio_sitio',
    description: 'Configura la página web de descargas de la app en el dominio del cliente o en cualquier hosting (Netlify, Cloudflare Pages, Hostinger, su propio servidor): la app consulta esa dirección, AVISA cuando hay versión nueva y el botón abre la página para descargarla. Deja la página editable en escritorio/descargas/index.html y, tras empaquetar, la carpeta escritorio/sitio/ lista para subir completa.',
    timeoutMs: 5 * 60_000,
    parameters: {
      type: 'object',
      required: ['url'],
      properties: {
        carpeta: { type: 'string' },
        url: { type: 'string', description: 'Dirección pública donde quedará la página, ej. https://descargas.textilesx.com/ o https://textilesx.netlify.app/' },
        modo: { type: 'string', enum: ['aviso', 'automatica'], description: 'aviso (por defecto): avisa y abre la página para descargar · automatica: descarga sola e instala al cerrar.' },
        descripcion: { type: 'string', description: 'Frase para la página, ej. "El sistema de producción de Textiles X".' },
        color: { type: 'string', description: 'Color de la marca para el botón, ej. #c8102e' },
      },
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { dir, rel } = dirApp(cwd, args?.carpeta)
      const conf = await leerConfig(dir)
      if (!conf) return `No hay app de escritorio en ${rel}/. Créala con escritorio_crear.`
      let url
      try { url = new URL(String(args.url).trim()) } catch { return '❌ La dirección debe ser completa, ej. https://descargas.textilesx.com/' }
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return '❌ Usa https:// (las actualizaciones no se descargan por http sin cifrar).'
      const base = url.href.endsWith('/') ? url.href : `${url.href}/`
      const otra = tecnologiaDe(conf) !== 'electron'
      const modo = args.modo === 'automatica' && !otra ? true : 'aviso'
      const antes = conf.sitio
      Object.assign(conf, { sitio: base, paginaVersiones: base, actualizaciones: modo })
      if (args.descripcion) conf.descripcionSitio = args.descripcion
      if (args.color) conf.colorSitio = args.color
      delete conf.publicacion
      await writeFile(path.join(dir, 'escritorio.config.json'), JSON.stringify(conf, null, 2) + '\n')
      if (!otra) {
        const archivoPkg = path.join(dir, 'package.json')
        const pkg = JSON.parse(await readFile(archivoPkg, 'utf8'))
        pkg.build.publish = [{ provider: 'generic', url: base }]
        if (!pkg.build.files.includes('package.json')) pkg.build.files.push('package.json')
        await writeFile(archivoPkg, JSON.stringify(pkg, null, 2) + '\n')
      }
      await asegurarScriptsSitio(dir)
      const pagina = path.join(dir, 'descargas', 'index.html')
      if (!existsSync(pagina)) { await mkdir(path.dirname(pagina), { recursive: true }); await cp(path.join(AQUI, 'plantilla', 'scripts', 'pagina-descargas.html'), pagina) }
      if (args.color) { let h = await readFile(pagina, 'utf8'); h = h.replace(/--acento:#[0-9a-fA-F]{3,8}/, `--acento:${args.color}`); await writeFile(pagina, h) }
      return [
        `✅ La app buscará versiones nuevas en ${base} y ${modo === 'aviso' ? 'AVISARÁ ("Hay una versión nueva") con un botón que abre esa página para descargarla' : 'se actualizará sola al cerrarse'}.`,
        `✅ Página editable: ${rel}/descargas/index.html (lee version.json: nombre, versión, novedades e instaladores).`,
        ...(otra && args.modo === 'automatica' ? ['ℹ Con Tauri y Java las actualizaciones son siempre con aviso: la app avisa y el botón abre la página para descargar.'] : []),
        ...(antes && antes !== base ? [`⚠ Cambió la dirección (antes ${antes}): las apps ya instaladas siguen buscando en la anterior hasta que instalen una versión hecha con la nueva.`] : []),
        '',
        'Cómo se publica cada versión (díselo al usuario):',
        `1. escritorio_empaquetar { version: "1.0.1", notas: "Qué cambió" } → arma ${rel}/sitio/ con la página, version.json, los instaladores y latest*.yml.`,
        `2. Subir TODO el contenido de ${rel}/sitio/ a ${base}, reemplazando lo anterior (Netlify: arrastrar la carpeta en "Deploys"; Hostinger/cPanel: Administrador de archivos; Cloudflare Pages: subir carpeta).`,
        '3. Las apps instaladas lo detectan al abrir y cada 4 horas.',
        'Importante: hay que empaquetar DESPUÉS de este paso (la dirección queda dentro del instalador). La primera versión que instalen los clientes ya debe traerla.',
        'Para Windows y Mac a la vez sin un Mac: escritorio_publicar compila en GitHub Actions y deja el sitio listo como "sitio-de-descargas" para descargar y subir (o lo publica solo en Netlify si el repo tiene los secretos NETLIFY_AUTH_TOKEN y NETLIFY_SITE_ID).',
      ].join('\n')
    },
  })

  ctx.tools.register({
    name: 'escritorio_publicar',
    description: 'Escribe el flujo de GitHub Actions que compila la app para Windows, Mac y Linux en los servidores de GitHub, publica los instaladores como versión (las apps instaladas se actualizan solas) y una página pública de descargas en GitHub Pages que siempre ofrece la última versión. No sube nada: devuelve los pasos para que el usuario apruebe el commit.',
    parameters: { type: 'object', properties: { carpeta: { type: 'string' }, descripcion: { type: 'string', description: 'Frase para la página de descargas, ej. "El sistema de pagos de las sedes".' }, pagina: { type: 'boolean', description: 'false para no crear la página de descargas.' } } },
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
      let paginaRel = null, visibilidad = null
      if (conf.sitio) await asegurarScriptsSitio(dir)
      if (args?.pagina !== false && gh && !conf.sitio) {
        const carpetaPagina = path.join(dir, 'descargas')
        await mkdir(carpetaPagina, { recursive: true })
        await writeFile(path.join(carpetaPagina, 'index.html'), paginaDescargas({ nombre: conf.nombre, owner: gh.owner, repo: gh.repo, color: conf.color || '#0a66ff', descripcion: args?.descripcion || '' }))
        if (existsSync(path.join(dir, 'build', 'icon.png'))) await cp(path.join(dir, 'build', 'icon.png'), path.join(carpetaPagina, 'icono.png'))
        paginaRel = path.relative(raiz, carpetaPagina).split(path.sep).join('/')
        try { const r = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'dsh-escritorio' } }); visibilidad = r.ok ? ((await r.json()).private ? 'privado' : 'público') : r.status === 404 ? 'privado' : null } catch {}
      }
      const tec = tecnologiaDe(conf)
      if (tec !== 'electron') paginaRel = null // la página de GitHub Pages lee las versiones de Electron; Tauri y Java usan escritorio_sitio
      await writeFile(flujo, flujoGithub({ dirRel, webDirRel: webConDeps, nombre: conf.nombre, paginaRel, sitio: conf.sitio || null, tecnologia: tec }))
      if (gh && !conf.sitio && tec === 'electron') {
        const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
        pkg.build.publish = [{ provider: 'github', owner: gh.owner, repo: gh.repo, releaseType: 'release' }]
        await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
        conf.publicacion = { owner: gh.owner, repo: gh.repo }
        conf.actualizaciones = true
        await writeFile(path.join(dir, 'escritorio.config.json'), JSON.stringify(conf, null, 2) + '\n')
      }
      return [
        `Flujo escrito: ${path.relative(cwd, flujo).split(path.sep).join('/')} (${NOMBRE_TEC[tec]}: Windows, Mac y Linux en paralelo; publica solo si los tres salen bien).`,
        ...(tec !== 'electron' && !conf.sitio ? ['ℹ Para que las apps instaladas AVISEN de versiones nuevas, configura la página de descargas con escritorio_sitio (puede ser la del cliente o un Netlify gratis) antes de la primera versión.'] : []),
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
        ...(conf.sitio ? [
          '',
          `Sitio del cliente (${conf.sitio}): cada versión publicada deja en esa ejecución de Actions el artefacto "sitio-de-descargas" (página + instaladores de Windows, Mac y Linux + latest*.yml). Se descarga y se sube completo al hosting del cliente.`,
          'Para que se publique solo en Netlify: agrega en el repo los secretos NETLIFY_AUTH_TOKEN y NETLIFY_SITE_ID (Settings → Secrets and variables → Actions). El repositorio puede ser privado: los clientes solo ven su página.',
        ] : []),
        ...(paginaRel ? [
          '',
          `Página de descargas: ${paginaRel}/index.html → se publica en https://${gh.owner.toLowerCase()}.github.io/${gh.repo}/ con cada versión. Detecta Windows/Mac/Linux y siempre baja la última versión.`,
          `Una sola vez, el usuario debe activar GitHub Pages: github.com/${gh.owner}/${gh.repo}/settings/pages → Source: "GitHub Actions".`,
          ...(visibilidad === 'privado' ? ['⚠ El repositorio parece PRIVADO: la página y las descargas no serán públicas y las apps instaladas no podrán bajar actualizaciones. Usa un repositorio público para esta app (el código de la base de datos queda protegido por los permisos de Supabase, no por esconder el código).'] : []),
        ] : []),
        'Si el repositorio es privado, las apps no podrán descargar actualizaciones sin un token: para uso interno conviene un repositorio aparte, público solo con los instaladores, o actualizar a mano.',
      ].join('\n')
    },
  })
}
