// Textos: página inicial de una app nueva, LEEME y reglas que recibe el modelo.

import { VERSIONES } from './base.js'
export const PAGINA_INICIAL = (o) => `<!DOCTYPE html>
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

const LEEME_OTRAS = (o) => `# ${o.nombre} — app de escritorio (${o.tecnologia === 'tauri' ? 'Tauri / Rust' : 'JavaFX / Java'})

Generada con dsh-escritorio. Misma interfaz (\`app/\`), automatizaciones (\`automatizaciones/\`) y \`window.escritorio\` que la versión Electron.

| Comando (en esta carpeta) | Qué hace |
|---|---|
| \`npm install\` | Una sola vez: herramientas${o.tecnologia === 'tauri' ? ' (la CLI de Tauri)' : ''} y dependencias del motor. |
| \`npm run probar\` | ${o.tecnologia === 'tauri' ? 'Compila con Rust (la primera vez tarda) y deja el programa en src-tauri/target/debug/.' : 'Compila con el JDK y abre la app en modo prueba.'} |
| \`npm run empaquetar\` | Crea el instalador de este sistema${o.tecnologia === 'tauri' ? ' en src-tauri/target/release/bundle/' : ' en paquete/instaladores/'}. |

Requisitos para compilar en el PC: ${o.tecnologia === 'tauri' ? 'Rust (rustup) y, en Windows, las herramientas de C++ de Visual Studio' : 'JDK 21 o más nuevo; para el .exe de Windows, WiX 3'}. Sin instalar nada: el flujo de GitHub Actions (escritorio_publicar) compila Windows, Mac y Linux.

- Código del programa: ${o.tecnologia === 'tauri' ? '`src-tauri/src/main.rs`' : '`src/main/java/escritorio/`'}. Ajustes: \`escritorio.config.json\`. Ícono: \`build/icono.svg\`.
- Si hay automatizaciones, el instalador lleva el Node que las corre (unos 40 MB más en el instalador). Sin automatizaciones no lo lleva.
- Las actualizaciones son con aviso: la app consulta \`version.json\` de la página de descargas y abre la página para descargar.
- Windows muestra "Windows protegió tu PC" la primera vez porque el instalador no está firmado: "Más información" → "Ejecutar de todas formas".
`

export const LEEME = (o) => o.tecnologia && o.tecnologia !== 'electron' ? LEEME_OTRAS(o) : `# ${o.nombre} — app de escritorio

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

export const REGLAS = [
  '## Escritorio (dsh-escritorio)',
  'When the user wants a desktop app (Windows/Mac installer, tray icon, global shortcut, access to local files, "que se instale en el PC"), use the dsh-escritorio tools instead of hand-writing Electron code:',
  '1. escritorio_crear wraps the project UI (Vite/React build, a static folder, a deployed URL, or a new starter page). For Vite it builds with base "./" automatically.',
  '2. In the UI, desktop features go through window.escritorio (archivos.abrir/guardar/mostrar, notificar, abrirEnNavegador, info, iniciarConSistema); always guard with `if (window.escritorio)` so the web version keeps working, with a browser fallback (download/upload).',
  '3. Always run escritorio_probar after creating or changing it: it really opens the app, checks errors, the bridge, tray and shortcut, and returns light/dark screenshots. Look at them and fix problems before saying it works.',
  'Technology: escritorio_crear { tecnologia } = electron (default, most tested), tauri (Rust, much lighter installer, uses the system WebView) or java (JavaFX). Use tauri or java only when the user asks for Rust/Tauri or Java. All three share app/ (web UI), automatizaciones/, motor/, window.escritorio, datos-en-vivo and the client download page; tauri/java updates are always notice-only and have no global shortcut. Compiling tauri needs Rust (and VS C++ tools on Windows), java needs JDK 21; if missing, escritorio_probar explains how to install them, and escritorio_publicar builds everything on GitHub Actions. Do not hand-edit src-tauri/ or src/main/java unless asked: the web UI and automations are where app features go.',
  '4. escritorio_empaquetar builds the installer for this computer. For Windows and Mac together and auto-updates, escritorio_publicar writes the GitHub Actions workflow; never push, tag or publish without the user\'s explicit approval.',
  '5. Be honest about signing: unsigned installers show a warning the first time on Windows (SmartScreen) and Mac (Gatekeeper).',
  '',
  '### Automations inside the desktop app',
  'The app has an automation engine that keeps running while the window is closed (tray). Each automation is escritorio/automatizaciones/<id>.js; create them with escritorio_automatizacion (it validates the trigger and code), then ALWAYS run escritorio_probar with soloAutomatizaciones:[id] and read the result, logs and robot screenshots before saying it works.',
  'Triggers ("cuando", one or a list): {cron:"0 18 * * 1-5"} (local time) · {cada:"15m", ya?:true} · {carpeta:"~/Documents/Entrada", archivos:"*.csv|*.xlsx"} · {tabla:"pagos", evento:"INSERT"|"UPDATE"|"DELETE"|"*", filtro?:"sede=eq.Norte"} (Supabase realtime) · {alIniciar:true} · {manual:true}. Options: tiempoMaximo ("10m" default), reintentos (backoff 30 s, 1 min…), ponerseAlDia (run once if the PC was off at the cron time), avisarError (default true), avisarExito, enPrueba:false (skip in tests, e.g. it sends real messages).',
  'ctx in ejecutar(ctx): disparo {tipo, datos, archivo, fila, anterior, hora} · config (= "variables" in escritorio.config.json) · registro(...) · progreso(%, texto) · notificar(titulo, cuerpo) · interfaz(evento, datos) → UI gets it via window.escritorio.automatizaciones.alEvento · ejecutar(otroId, datos) chains another automation · pausa("2s") · cancelado() · archivos {ruta, existe, leer(p,"texto"|"json"|"bytes"), escribir, agregar, listar(dir, patron), mover, copiar, crearCarpeta, csv(filas), leerCsv(texto), carpetaApp} (~ = user home) · estado {leer(k, def), guardar(k, v)} persisted per automation · db = Supabase client (needs escritorio_datos) · http = fetch.',
  'Private data per PC (passwords of a platform the robot logs into): declare "secretos" in escritorio_automatizacion and read them with await secreto("clave"); each PC stores them encrypted from the panel (Automatizaciones → the automation → Datos privados). Never put passwords in "variables" or code.',
  'Robots: const p = await robot({ sesion?: "nombre", visible?: false, espera?: 30000 }) returns a Playwright Page using the browser already on the PC (Edge on Windows, Chrome on Mac/Linux; nothing to download). Use role/label locators (getByRole, getByLabel, getByText), never brittle CSS chains; wait for content before reading. p.descargar(() => click) saves a download and returns its path; p.captura("nombre") saves a screenshot shown in the panel. Errors automatically save a screenshot of every open page. A named sesion keeps cookies/logins between runs: prefer a one-time visible login (robot({sesion, visible:true}) and wait for the logged-in page) over storing passwords; if credentials are unavoidable put them in "variables", never in code, and tell the user they live inside the installed app.',
  'Each run happens in a separate process with a time limit, so a stuck robot never freezes the app. History (result, logs, screenshots) lives in the panel: tray → Automatizaciones, or window.escritorio.automatizaciones.abrirPanel(). From the UI: automatizaciones.lista/ejecutar(id, datos)/activar(id, bool)/cancelar/historial/alCambiar.',
  '',
  '### Real-time data for several PCs',
  'For an app used on several computers with live shared data, use escritorio_datos with Supabase (url + public anon/publishable key only; it refuses service_role/secret keys). Pass "tablas" so it generates supabase/escritorio.sql: tables with id/creado_por/creado/actualizado, row-level security by "acceso" (autenticados · propietario · por-columna, e.g. each PC/sede sees only its rows · solo-lectura), a perfiles table with rol admin/usuario and the access column, and realtime enabled. With aplicar:true and SUPABASE_ACCESS_TOKEN on the PC it runs the SQL; otherwise tell the user to paste it in the SQL Editor, create one user per person/PC, and set the admin and each user\'s sede with the commented lines.',
  'Database changes over time: every escritorio_datos call writes numbered migrations in supabase/migraciones/ (applied once, recorded in public.migraciones) and supabase/aplicar-todo.sql (safe to paste whole). To rename or remove columns/tables use "cambios" (quitar needs confirmar:true after the user approves; it keeps a respaldo_* copy) and pass the NEW state in "tablas". Before such changes, raise the minimum app version (escritorio_empaquetar { minima } and/or the admin System tab): older apps are blocked with an update screen and the database refuses their writes.',
  'Offline mode is built into lib/datos-en-vivo.js: everything already viewed is cached on the PC (IndexedDB), saves/deletes without internet appear instantly in enVivo lists with _pendiente: true (show a small "pending" mark for those rows) and upload by themselves in order when the connection returns; new rows get a uuid id on the client (pass { generarId: false } only for non-uuid ids). Call datos.precargar([...main tables]) after login so screens work offline even if never opened. Changes the database rejects on upload go to datos.rechazados() and <estado-conexion> shows them with Retry/Discard. Never block a screen just because there is no internet.',
  'Robustness built in: errors from every PC (app, UI, automations) go to app_errores and the admin System tab; every insert/update/delete is audited (who, when, which PC, before/after); a daily backup automation (copia-de-seguridad) saves all tables on the admin PC; datos.guardar detects conflicts when another PC changed the row (pass the row with its "actualizado") and <estado-conexion> lets the user choose.',
  'Users and roles: pass "roles" to escritorio_datos (admin always exists). Each role has permisos per table {acciones: leer/crear/cambiar/borrar, alcance: todo | sede | propio}, automatizaciones it may run (ids or "*") and gestionaUsuarios. Permissions are data: the admin edits them later from the app. Users are created INSIDE the app with <admin-usuarios> through the server function supabase/functions/gestionar-usuarios (deploy it; the secret key stays in Supabase). Only the first admin is created in the Supabase dashboard.',
  'Client download page: when the app is for a client (they have a website, not a repository), call escritorio_sitio with the page URL (their domain or a host like Netlify) BEFORE the first installer is delivered. Default modo aviso: the app notifies of a new version and opens that page; nothing installs by itself. Each release: escritorio_empaquetar { version, notas }, then upload the whole escritorio/sitio/ folder to that host. For Windows+Mac at once, escritorio_publicar builds on GitHub Actions and leaves the artifact sitio-de-descargas (or deploys to Netlify with NETLIFY_AUTH_TOKEN/NETLIFY_SITE_ID secrets).',
  'Automations with several PCs: once Supabase is connected, automations only run for a logged-in user whose role allows them; scheduled ones (cron/cada) and table triggers run on ONE PC per turn (shared turn table); set unaVez:false when each PC must run it (local backups), and correEn:{ sede:"Norte" } / { rol:"admin" } / { equipo:"CAJA-1" } to pin where it runs. Every run is logged to automatizacion_corridas (Actividad tab).',
  'In the UI: import src/lib/datos.js once; wrap the whole app in <acceso-escritorio> (login screen until there is a session), put <estado-conexion> and <usuario-escritorio> in the top bar, read with datos.enVivo(tabla, {filtro, orden}, setFilas) and write with datos.guardar/borrar (queued while offline). Never put a Postgres connection string (Neon, Supabase DB password) inside an installed app: anyone can extract it; use Supabase with RLS, or an API server in between.',
].join('\n')

