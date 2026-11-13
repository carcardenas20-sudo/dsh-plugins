// dsh-automatizador — automatizaciones serias (Java o Python) dentro de DeepSeek Harness.
//
// El agente no escribe un script suelto: genera un proyecto con núcleo profesional
// (configuración por .env, registro con secretos ocultos, reintentos, modo prueba,
// "ya hecho" para no duplicar, candado contra ejecuciones dobles, historial y avisos),
// lo prueba en modo prueba leyendo el registro, y lo deja listo para servidor
// (Docker + supercronic, docker-compose, Fly.io) o para el Programador de tareas de Windows.

import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'automatizador'
export const inject = ['tools', 'workingDirectory', 'systemPrompt']

const PLANTILLAS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'plantillas')
const DEFAULTS = { carpeta: 'automatizaciones', minutosPrueba: 10, versionPlaywright: '1.49.0', supercronic: 'v0.2.33' }

export const slug = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)

// Texto seguro para meterlo en docstrings, comentarios Java, strings y XML.
export const textoSeguro = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/["\\`<>&]/g, '').replace(/\*\//g, '* /').replace(/"""/g, '').trim().slice(0, 200)

export function normalizarVariables(vars = []) {
  const vistos = new Set()
  const out = []
  for (const v of vars) {
    const nombre = String(typeof v === 'string' ? v : v?.nombre ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^[^A-Z]+/, '')
    if (!nombre || vistos.has(nombre)) continue
    vistos.add(nombre)
    out.push({ nombre, descripcion: textoSeguro(v?.descripcion ?? ''), ejemplo: String(v?.ejemplo ?? '').replace(/[\r\n]/g, ' ') })
  }
  return out
}

export function validarCron(expr) {
  const partes = String(expr ?? '').trim().split(/\s+/)
  if (partes.length !== 5) return 'el horario debe ser cron de 5 campos: minuto hora día mes día-semana (ej. "0 7 * * 1-5")'
  if (!partes.every((p) => /^[\d*\/,\-A-Za-z]+$/.test(p))) return `horario inválido: ${expr}`
  return null
}

// Convierte los cron sencillos al Programador de tareas de Windows. Devuelve null si no se puede.
export function cronAWindows(expr) {
  const [mi, ho, dia, mes, dsem] = String(expr).trim().split(/\s+/)
  const DIAS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  if (dia !== '*' || mes !== '*') return null
  const m = /^\*\/(\d+)$/.exec(mi)
  if (m && ho === '*' && dsem === '*') return { tipo: 'cadaMinutos', minutos: Number(m[1]) }
  if (!/^\d+$/.test(mi)) return null
  const horas = ho.split(',')
  if (!horas.every((h) => /^\d+$/.test(h) && Number(h) < 24) || Number(mi) > 59) return null
  const horasTxt = horas.map((h) => `${h.padStart(2, '0')}:${mi.padStart(2, '0')}`)
  if (dsem === '*') return { tipo: 'diario', horas: horasTxt }
  const dias = []
  for (const parte of dsem.split(',')) {
    const r = /^(\d)(?:-(\d))?$/.exec(parte)
    if (!r) return null
    const a = Number(r[1]) % 7, b = r[2] === undefined ? a : Number(r[2])
    for (let d = a; d <= (b === 7 ? 7 : b); d++) dias.push(DIAS[d % 7])
  }
  return { tipo: 'semanal', horas: horasTxt, dias: [...new Set(dias)] }
}

function envEjemplo(o) {
  const l = [
    `# ${o.nombre} — copia este archivo como .env y llena los valores.`,
    '# En el servidor puedes poner estas mismas variables como variables de entorno (o secretos de Fly.io);',
    '# las del servidor ganan sobre las del archivo. NUNCA subas el .env a git.',
    '',
  ]
  if (o.variables.length) {
    l.push('# --- Variables de esta automatización ---')
    for (const v of o.variables) {
      if (v.descripcion) l.push(`# ${v.descripcion}`)
      l.push(`${v.nombre}=${v.ejemplo}`)
    }
    l.push('')
  }
  l.push(
    '# --- Avisos (opcional) ---',
    '# Webhook de Slack, Discord, Google Chat, Teams o n8n. Llega {text, content, titulo, detalle}.',
    'AVISO_WEBHOOK_URL=',
    '# Telegram: crea un bot con @BotFather y consigue tu chat id.',
    'TELEGRAM_BOT_TOKEN=',
    'TELEGRAM_CHAT_ID=',
    '# 1 = avisar también cuando sale bien (por defecto solo avisa los errores)',
    'AVISAR_EXITO=0',
    '',
    '# 1 = todo corre en modo prueba aunque no se pase --prueba (útil en un servidor de pruebas)',
    'MODO_PRUEBA=0',
    '',
  )
  return l.join('\n')
}

const GITIGNORE = ['.env', 'logs/', 'datos/', 'target/', 'build/', '__pycache__/', '*.pyc', '.venv/', ''].join('\n')

function comandoContenedor(o) {
  return o.lenguaje === 'python' ? 'python main.py' : 'java -jar app.jar'
}

function dockerfile(o, cfg) {
  const sc = `ADD --chmod=755 https://github.com/aptible/supercronic/releases/download/${cfg.supercronic}/supercronic-linux-amd64 /usr/local/bin/supercronic`
  const cola = [
    `ENV TZ=${o.zonaHoraria} LANG=C.UTF-8`,
    sc,
    `RUN printf '%s\\n' '${o.horario} cd /app && ${comandoContenedor(o)}' > /app/crontab`,
    '# Por defecto queda corriendo y ejecuta según el horario. Para una sola vez:',
    `#   docker run --rm --env-file .env imagen ${comandoContenedor(o)} --prueba`,
    'CMD ["supercronic", "-passthrough-logs", "/app/crontab"]',
    '',
  ]
  const tz = 'RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*'
  if (o.lenguaje === 'python') {
    const base = o.navegador ? `mcr.microsoft.com/playwright/python:v${cfg.versionPlaywright}-noble` : 'python:3.12-slim'
    return [
      `FROM ${base}`,
      tz,
      'ENV PYTHONUNBUFFERED=1',
      'WORKDIR /app',
      'COPY requirements.txt .',
      'RUN pip install --no-cache-dir -r requirements.txt',
      'COPY . .',
      ...cola,
    ].join('\n')
  }
  const base = o.navegador ? `mcr.microsoft.com/playwright/java:v${cfg.versionPlaywright}-noble` : 'eclipse-temurin:21-jre'
  return [
    '# 1) Compilar',
    'FROM maven:3.9-eclipse-temurin-21 AS compilar',
    'WORKDIR /src',
    'COPY pom.xml .',
    'RUN mvn -q -B dependency:go-offline',
    'COPY src ./src',
    'RUN mvn -q -B -DskipTests package',
    '',
    '# 2) Correr (imagen liviana, solo el JRE)',
    `FROM ${base}`,
    tz,
    'WORKDIR /app',
    `COPY --from=compilar /src/target/${o.nombre}.jar /app/app.jar`,
    ...cola,
  ].join('\n')
}

const dockerCompose = (o) => [
  'services:',
  `  ${o.nombre}:`,
  '    build: .',
  '    env_file: .env',
  '    restart: unless-stopped',
  '    volumes:',
  '      - ./datos:/app/datos   # "ya hecho" y candado: sobreviven a reinicios',
  '      - ./logs:/app/logs     # registro e historial de ejecuciones',
  '',
].join('\n')

const flyToml = (o) => [
  `app = "${o.nombre}"`,
  'primary_region = "bog"',
  '',
  '# Trabajador sin web: no expone puertos, solo corre el horario.',
  '[build]',
  '',
  '[[vm]]',
  '  size = "shared-cpu-1x"',
  `  memory = "${o.navegador ? '1gb' : o.lenguaje === 'java' ? '512mb' : '256mb'}"`,
  '',
  '# Guarda datos/ (lo ya hecho) aunque la máquina se reinicie. Crear antes con:',
  `#   fly volumes create datos --region bog --size 1 -a ${o.nombre}`,
  '[mounts]',
  '  source = "datos"',
  '  destination = "/app/datos"',
  '',
].join('\n')

function scriptsWindows(o) {
  const correr = o.lenguaje === 'python'
    ? 'if exist ".venv\\Scripts\\python.exe" (set PY=.venv\\Scripts\\python.exe) else (set PY=python)\r\n%PY% main.py %*'
    : `java -jar target\\${o.nombre}.jar %*`
  const cmd = `@echo off\r\nREM Ejecuta ${o.nombre} desde su carpeta. Lo usa el Programador de tareas.\r\ncd /d "%~dp0"\r\nif not exist logs mkdir logs\r\n${correr} >> logs\\consola.log 2>&1\r\n`
  const w = cronAWindows(o.horario)
  let trigger
  if (!w) trigger = `# El horario "${o.horario}" no se traduce solo; ajusta el disparador a mano:\r\n$disparadores = @(New-ScheduledTaskTrigger -Daily -At 07:00)`
  else if (w.tipo === 'cadaMinutos') trigger = `$disparadores = @(New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes ${w.minutos}))`
  else if (w.tipo === 'diario') trigger = `$disparadores = @(${w.horas.map((h) => `New-ScheduledTaskTrigger -Daily -At ${h}`).join(', ')})`
  else trigger = `$disparadores = @(${w.horas.map((h) => `New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${w.dias.join(',')} -At ${h}`).join(', ')})`
  const ps1 = [
    `# Programa "${o.nombre}" en el Programador de tareas de Windows (horario cron: ${o.horario}).`,
    '# Ojo: Windows usa la hora del computador, no la zona del .env.',
    '# Uso (PowerShell, en esta carpeta):   powershell -ExecutionPolicy Bypass -File programar_windows.ps1',
    '# Para quitarla:                        Unregister-ScheduledTask -TaskName "' + o.nombre + '" -Confirm:$false',
    '$ErrorActionPreference = "Stop"',
    '$carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$accion = New-ScheduledTaskAction -Execute (Join-Path $carpeta "ejecutar.cmd") -WorkingDirectory $carpeta',
    trigger,
    '# Si el PC estaba apagado a la hora, corre apenas prenda; nunca dos a la vez; máximo 6 horas.',
    '$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 6)',
    `Register-ScheduledTask -TaskName "${o.nombre}" -Action $accion -Trigger $disparadores -Settings $ajustes -Description "${o.descripcion}" -Force | Out-Null`,
    `Write-Host "Listo: tarea '${o.nombre}' programada. Revisa logs\\ despues de la primera ejecucion."`,
    '',
  ].join('\r\n')
  return { cmd, ps1 }
}

function readme(o) {
  const py = o.lenguaje === 'python'
  const local = py
    ? ['python -m venv .venv', '.venv\\Scripts\\activate        # Windows  (Linux/Mac: source .venv/bin/activate)', 'pip install -r requirements.txt', o.navegador ? 'playwright install chromium' : null, 'copy .env.example .env           # y llénalo', 'python main.py --prueba           # prueba: no envía ni modifica nada', 'python main.py                    # de verdad'].filter(Boolean)
    : ['mvn -q package                    # genera target/' + o.nombre + '.jar', 'copy .env.example .env            # y llénalo', `java -jar target/${o.nombre}.jar --prueba`, `java -jar target/${o.nombre}.jar`]
  return `# ${o.nombre}

${o.descripcion || 'Automatización.'}

- Lenguaje: **${py ? 'Python 3.12' : 'Java 21'}**${o.navegador ? ' + Playwright (navegador)' : ''}
- Horario: \`${o.horario}\` (${o.zonaHoraria})
- Generada con dsh-automatizador.

## Dónde va cada cosa

| Archivo | Para qué |
|---|---|
| \`${py ? 'tarea.py' : 'src/main/java/automatizacion/Tarea.java'}\` | **La lógica de negocio.** Es lo único que normalmente se edita. |
| \`${py ? 'nucleo/' : 'src/main/java/automatizacion/nucleo/'}\` | Configuración, registro, reintentos, modo prueba, "ya hecho", candado, avisos. No hace falta tocarlo. |
| \`.env\` | Credenciales y parámetros (copiar de \`.env.example\`). Nunca se sube a git. |
| \`logs/AAAA-MM-DD.jsonl\` | Registro detallado (los secretos salen como \`***\`). |
| \`logs/ejecuciones.jsonl\` | Una línea por ejecución: estado, duración, pasos, resultado o error. |
| \`datos/\` | Lo que ya se procesó (para no repetir) y el candado. |

## Correr en tu PC

\`\`\`
${local.join('\n')}
\`\`\`

Opciones: \`--prueba\` (no hace cambios externos), \`--forzar\` (re-procesa aunque ya esté hecho).
Código de salida: 0 bien, 1 error (sirve para cualquier programador de tareas).

## Dejarla corriendo en un servidor (recomendado)

Con Docker, en cualquier servidor Linux (VPS, Railway, Render, un PC con Docker):

\`\`\`
docker compose up -d --build      # queda corriendo y ejecuta según el horario
docker compose logs -f            # ver lo que va pasando
docker compose run --rm ${o.nombre} ${comandoContenedor(o)} --prueba   # una prueba manual
\`\`\`

En Fly.io (sin web, solo el horario):

\`\`\`
fly launch --no-deploy --copy-config
fly volumes create datos --region bog --size 1
fly secrets set ${o.variables.map((v) => `${v.nombre}=...`).join(' ') || 'VARIABLE=valor'}
fly deploy
\`\`\`

## Dejarla corriendo en Windows

\`\`\`
powershell -ExecutionPolicy Bypass -File programar_windows.ps1
\`\`\`

Crea una tarea en el Programador de tareas que ejecuta \`ejecutar.cmd\` (la salida queda en \`logs\\consola.log\`).
${py ? '' : 'Antes compila una vez con `mvn -q package`.\n'}
## Cuando algo falla

1. Mira la última línea de \`logs/ejecuciones.jsonl\`: dice qué paso falló y el error.
2. El detalle completo está en \`logs/<fecha>.jsonl\` (busca \`"nivel":"error"\`).
3. Corrige, prueba con \`--prueba\` y vuelve a correr. Lo que ya se hizo no se repite.
`
}

export async function generar(cwd, entrada, cfg = DEFAULTS) {
  const nombre = slug(entrada.nombre)
  if (!nombre) throw new Error('"nombre" no puede estar vacío')
  const lenguaje = String(entrada.lenguaje ?? '').toLowerCase()
  if (!['python', 'java'].includes(lenguaje)) throw new Error('"lenguaje" debe ser python o java')
  const horario = String(entrada.horario ?? '0 7 * * *').trim()
  const err = validarCron(horario)
  if (err) throw new Error(err)
  const zonaHoraria = String(entrada.zonaHoraria ?? 'America/Bogota').replace(/[^A-Za-z0-9_/+-]/g, '')
  const o = {
    nombre, lenguaje, horario, zonaHoraria,
    descripcion: textoSeguro(entrada.descripcion),
    navegador: Boolean(entrada.navegador),
    variables: normalizarVariables(entrada.variables),
  }
  const relDir = path.posix.join(cfg.carpeta, nombre)
  const dir = path.join(cwd, cfg.carpeta, nombre)
  if (existsSync(dir)) throw new Error(`ya existe ${relDir}; edítala directamente o usa otro nombre`)
  await mkdir(path.dirname(dir), { recursive: true })
  await cp(path.join(PLANTILLAS, lenguaje), dir, { recursive: true })

  const vars = o.variables.map((v) => `"${v.nombre}"`).join(', ')
  const deps = o.navegador && lenguaje === 'java'
    ? `    <dependency>\n      <groupId>com.microsoft.playwright</groupId>\n      <artifactId>playwright</artifactId>\n      <version>${cfg.versionPlaywright}</version>\n    </dependency>\n`
    : ''
  const reemplazar = (t) => t.replaceAll('{{NOMBRE}}', o.nombre).replaceAll('{{DESCRIPCION}}', o.descripcion || o.nombre)
    .replaceAll('{{VARIABLES}}', vars).replaceAll('{{DEPENDENCIAS}}', deps)
  const archivos = []
  const recorrer = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await recorrer(p)
      else {
        const t = await readFile(p, 'utf8')
        if (t.includes('{{')) await writeFile(p, reemplazar(t))
        archivos.push(path.relative(dir, p).split(path.sep).join('/'))
      }
    }
  }
  await recorrer(dir)

  const win = scriptsWindows(o)
  const extra = {
    '.env.example': envEjemplo(o),
    '.gitignore': GITIGNORE,
    '.dockerignore': ['.env', 'logs', 'datos', 'target', 'build', '.venv', '__pycache__', ''].join('\n'),
    Dockerfile: dockerfile(o, cfg),
    'docker-compose.yml': dockerCompose(o),
    'fly.toml': flyToml(o),
    'ejecutar.cmd': win.cmd,
    'programar_windows.ps1': win.ps1,
    'README.md': readme(o),
  }
  if (lenguaje === 'python') extra['requirements.txt'] = o.navegador ? `playwright==${cfg.versionPlaywright}\n` : '# Solo usa la librería estándar. Agrega aquí lo que necesites (requests, pandas, openpyxl…).\n'
  for (const [f, t] of Object.entries(extra)) { await writeFile(path.join(dir, f), t); archivos.push(f) }
  return { ...o, carpeta: relDir, archivos: archivos.sort() }
}

// ---------- ejecutar ----------

function correr(cmd, args, { cwd, signal, timeoutMs, env }) {
  return new Promise((resolve) => {
    let salida = ''
    const agregar = (b) => { salida += b.toString('utf8'); if (salida.length > 400_000) salida = salida.slice(-200_000) }
    let hijo
    try {
      // En Windows los .cmd (mvn.cmd) solo corren a través de la consola.
      hijo = spawn(cmd, args, { cwd, env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...env }, signal, windowsHide: true, shell: /\.cmd$/i.test(cmd) })
    } catch (e) { return resolve({ codigo: null, salida: '', error: e }) }
    const reloj = setTimeout(() => hijo.kill('SIGKILL'), timeoutMs)
    hijo.stdout.on('data', agregar)
    hijo.stderr.on('data', agregar)
    hijo.on('error', (error) => { clearTimeout(reloj); resolve({ codigo: null, salida, error }) })
    hijo.on('close', (codigo, senal) => { clearTimeout(reloj); resolve({ codigo, salida, senal }) })
  })
}

async function primeroQueExista(candidatos, opts) {
  for (const [cmd, args] of candidatos) {
    const r = await correr(cmd, [...args, '--version'], { ...opts, timeoutMs: 20_000 })
    if (r.codigo === 0) return [cmd, args]
  }
  return null
}

async function listarJava(d) {
  const out = []
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) out.push(...await listarJava(p))
    else if (e.name.endsWith('.java')) out.push(p)
  }
  return out
}

async function masNuevo(d) {
  let t = 0
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    t = Math.max(t, e.isDirectory() ? await masNuevo(p) : (await stat(p)).mtimeMs)
  }
  return t
}

// Prepara el comando según el lenguaje. Java: Maven si está; si no, javac (solo sin dependencias).
async function prepararComando(dir, opts) {
  const esPython = existsSync(path.join(dir, 'main.py'))
  if (esPython) {
    const venv = [path.join(dir, '.venv', 'Scripts', 'python.exe'), path.join(dir, '.venv', 'bin', 'python')].find(existsSync)
    const py = venv ? [venv, []] : await primeroQueExista([['python3', []], ['python', []], ['py', ['-3']]], opts)
    if (!py) throw new Error('no encontré Python (probé python3, python y py). Instálalo o crea .venv en la carpeta.')
    return { lenguaje: 'python', cmd: py[0], args: [...py[1], 'main.py'], compilacion: '' }
  }
  if (!existsSync(path.join(dir, 'pom.xml'))) throw new Error('la carpeta no parece una automatización (no hay main.py ni pom.xml)')
  const nombre = path.basename(dir)
  const jar = path.join(dir, 'target', `${nombre}.jar`)
  const pom = await readFile(path.join(dir, 'pom.xml'), 'utf8')
  const tieneDeps = /<dependency>/.test(pom)
  const mvn = await primeroQueExista([['mvn', []], ['mvn.cmd', []]], opts)
  let nota
  if (mvn) {
    const fuentes = await masNuevo(path.join(dir, 'src'))
    const viejo = !existsSync(jar) || (await stat(jar)).mtimeMs < Math.max(fuentes, (await stat(path.join(dir, 'pom.xml'))).mtimeMs)
    if (!viejo) return { lenguaje: 'java', cmd: 'java', args: ['-jar', jar], compilacion: '' }
    const r = await correr(mvn[0], ['-q', '-B', '-DskipTests', 'package'], { ...opts, cwd: dir, timeoutMs: 15 * 60_000 })
    if (r.codigo === 0) return { lenguaje: 'java', cmd: 'java', args: ['-jar', jar], compilacion: r.salida }
    // Sin dependencias se puede compilar con javac (útil sin internet); si no, el error de Maven es el que vale.
    if (tieneDeps) return { error: `falló la compilación con Maven:\n${recortarFinal(r.salida, 6000)}` }
    nota = `Maven falló (${/could not be resolved|Could not transfer|Name or service not known|UnknownHost/i.test(r.salida) ? 'sin acceso al repositorio de Maven' : 'ver error abajo si javac también falla'}); compilé con javac.`
  } else if (tieneDeps) throw new Error('el pom.xml tiene dependencias y no encontré Maven (mvn). Instálalo para compilar.')
  const javac = await primeroQueExista([['javac', []]], opts)
  if (!javac) throw new Error('no encontré Maven ni javac. Instala un JDK 21.')
  const build = path.join(dir, 'build')
  await mkdir(build, { recursive: true })
  // Lista de fuentes en un archivo: evita el límite de longitud de comando en Windows.
  const lista = path.join(build, 'fuentes.txt')
  await writeFile(lista, (await listarJava(path.join(dir, 'src', 'main', 'java'))).map((f) => `"${f.replaceAll('\\', '/')}"`).join('\n'))
  const r = await correr('javac', ['-encoding', 'UTF-8', '-d', build, `@${lista}`], { ...opts, cwd: dir, timeoutMs: 5 * 60_000 })
  if (r.codigo !== 0) return { error: `falló la compilación (javac):\n${recortarFinal(r.salida, 6000)}` }
  return { lenguaje: 'java', cmd: 'java', args: ['-cp', build, 'automatizacion.Main'], compilacion: r.salida, nota }
}

const recortarFinal = (t, n) => (t.length > n ? '…' + t.slice(-n) : t)

export async function leerEjecuciones(dir, n = 10) {
  const f = path.join(dir, 'logs', 'ejecuciones.jsonl')
  if (!existsSync(f)) return []
  const lineas = (await readFile(f, 'utf8')).split('\n').filter(Boolean)
  return lineas.slice(-n).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

export async function probar(cwd, { nombre, modo = 'prueba', forzar = false }, { signal, minutos = DEFAULTS.minutosPrueba, carpeta = DEFAULTS.carpeta } = {}) {
  const dir = path.join(cwd, carpeta, slug(nombre))
  if (!existsSync(dir)) throw new Error(`no existe ${carpeta}/${slug(nombre)}`)
  const opts = { cwd: dir, signal }
  const prep = await prepararComando(dir, opts)
  if (prep.error) return { ok: false, etapa: 'compilacion', detalle: prep.error }
  const antes = (await leerEjecuciones(dir, 1000)).length
  const args = [...prep.args]
  if (modo !== 'real') args.push('--prueba')
  if (forzar) args.push('--forzar')
  const r = await correr(prep.cmd, args, { ...opts, timeoutMs: minutos * 60_000 })
  const todas = await leerEjecuciones(dir, 1000)
  const ultima = todas.length > antes ? todas[todas.length - 1] : null
  return {
    ok: r.codigo === 0 && ultima?.estado === 'ok',
    lenguaje: prep.lenguaje,
    ...(prep.nota ? { nota: prep.nota } : {}),
    modo: modo === 'real' ? 'real' : 'prueba',
    codigoSalida: r.codigo,
    seCorto: r.codigo === null ? (r.error ? String(r.error.message) : `se detuvo (${r.senal ?? 'tiempo agotado'}) a los ${minutos} min`) : undefined,
    ejecucion: ultima,
    consola: recortarFinal(r.salida, 8000),
  }
}

async function listarAutomatizaciones(cwd, carpeta) {
  const base = path.join(cwd, carpeta)
  if (!existsSync(base)) return []
  const out = []
  for (const e of await readdir(base, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const dir = path.join(base, e.name)
    const lenguaje = existsSync(path.join(dir, 'main.py')) ? 'python' : existsSync(path.join(dir, 'pom.xml')) ? 'java' : null
    if (!lenguaje) continue
    const ult = (await leerEjecuciones(dir, 1))[0]
    out.push({ nombre: e.name, lenguaje, ultima: ult ? { inicio: ult.inicio, estado: ult.estado, modo: ult.modo, error: ult.error } : null })
  }
  return out
}

export function resumenEjecuciones(lista) {
  const reales = lista.filter((e) => e.modo === 'real')
  const ok = reales.filter((e) => e.estado === 'ok').length
  return {
    total: lista.length,
    reales: reales.length,
    exitoReales: reales.length ? `${Math.round((ok / reales.length) * 100)}%` : 'sin ejecuciones reales',
    duracionPromedio: lista.length ? Math.round(lista.reduce((s, e) => s + (Number(e.segundos) || 0), 0) / lista.length * 10) / 10 : 0,
    ejecuciones: lista.map((e) => ({
      inicio: e.inicio, modo: e.modo, estado: e.estado, segundos: e.segundos,
      ...(e.error ? { error: e.error, pasoFallido: (e.pasos ?? []).find((p) => p.ok === false)?.paso } : {}),
      resultado: e.resultado,
    })).reverse(),
  }
}

// ---------- plugin ----------

const REGLAS = [
  '## Automatizaciones (dsh-automatizador)',
  'When the user wants an automation (a recurring job, a bot, scraping, filling portals, syncing data, reports, sending messages), do not write a loose script:',
  '1. Ask only what is missing: what it does, Java or Python (default to the language of the project or Java), the schedule, and which credentials/parameters it needs. Then call automatizacion_crear.',
  '2. Write the business logic only in the generated task file (tarea.py or Tarea.java). Do not modify the core (nucleo/) unless the user asks.',
  '3. Split the work into named steps (Python: with ctx.paso(...); Java: ctx.paso(...) / ctx.pasoCon(...)). Wrap every network call or external system in ctx.reintentar. Log what matters with ctx.log (Python) / ctx.log() (Java), including counts and ids.',
  '4. Every side effect (send, save, submit, pay, delete, write to someone else\'s system) must be skipped when ctx.prueba is true, logging what WOULD happen. Use ctx.ya_hecho/ctx.yaHecho + ctx.marcar with a stable business key so re-runs never duplicate work.',
  '5. All credentials and parameters come from ctx.config and .env (add them to .env.example and to the required variables). Never hard-code secrets or put real values in .env.example.',
  '6. Prefer official APIs, files or databases over screen scraping. For web portals, explore the real page first (open it, read the HTML/network requests or record with `playwright codegen`) and use stable selectors (role, label, data-* or ids) with explicit waits, never fixed sleeps or guessed selectors.',
  '7. Test with automatizacion_probar in prueba mode, read the returned run record and console, fix and repeat until estado is ok and the logged actions are right. Run in real mode only when the user explicitly asks for it.',
  '8. Before telling the user it is done: explain how to fill .env, how to run it, and how to leave it running (docker compose / Fly.io for servers, programar_windows.ps1 for Windows) as described in its README. Never deploy or schedule anything yourself without the user\'s approval.',
].join('\n')

const salidaTexto = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }

export function textoPrueba(p) {
  if (p.etapa === 'compilacion') return `❌ No compiló.\n${p.detalle}`
  const e = p.ejecucion
  const l = [`${p.ok ? '✅' : '❌'} Ejecución en modo ${p.modo} (${p.lenguaje}) — código de salida ${p.codigoSalida ?? 'ninguno'}`]
  if (p.nota) l.push(`Nota: ${p.nota}`)
  if (p.seCorto) l.push(`Se cortó: ${p.seCorto}`)
  if (e) {
    l.push(`Estado: ${e.estado} · ${e.segundos} s`)
    if (e.error) l.push(`Error: ${e.error}`)
    for (const s of e.pasos ?? []) l.push(`  ${s.ok ? '✓' : '✗'} ${s.paso} (${s.segundos} s)${s.error ? ' — ' + s.error : ''}`)
    l.push(`Resultado: ${JSON.stringify(e.resultado ?? {})}`)
  } else l.push('No quedó registro en logs/ejecuciones.jsonl (falló antes de arrancar el núcleo).')
  l.push('', '--- consola ---', p.consola || '(vacía)')
  return l.join('\n')
}

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}) }

  ctx.systemPrompt.section({ name: 'automatizador', order: 2460, interpolate: false, text: REGLAS })

  ctx.tools.register({
    name: 'automatizacion_crear',
    description:
      'Crea el proyecto de una automatización profesional (Python o Java) en automatizaciones/<nombre>/: núcleo con .env, registro (secretos ocultos), ' +
      'reintentos, modo prueba, "ya hecho" para no duplicar, candado, historial y avisos por webhook/Telegram; más Dockerfile con horario (supercronic), ' +
      'docker-compose, fly.toml, script para el Programador de tareas de Windows y README. Después escribe la lógica en tarea.py o Tarea.java y pruébala con automatizacion_probar.',
    parameters: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre corto, por ejemplo "reporte-ventas-diario"' },
        lenguaje: { type: 'string', enum: ['python', 'java'] },
        descripcion: { type: 'string', description: 'Qué hace, en una frase' },
        horario: { type: 'string', description: 'Cron de 5 campos (minuto hora día mes día-semana). Por defecto "0 7 * * *" (7:00 a. m. diario). Lunes a viernes 6:30: "30 6 * * 1-5"' },
        zonaHoraria: { type: 'string', description: 'Zona IANA para el horario en el servidor. Por defecto America/Bogota' },
        navegador: { type: 'boolean', description: 'true si necesita manejar un navegador (portales web sin API): agrega Playwright y la imagen de Docker con navegadores' },
        variables: {
          type: 'array',
          description: 'Credenciales y parámetros que necesita (van a .env). Ej: PORTAL_USUARIO, PORTAL_CLAVE, CARPETA_SALIDA',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string', description: 'MAYÚSCULAS_CON_GUIONES' },
              descripcion: { type: 'string' },
              ejemplo: { type: 'string', description: 'Valor de ejemplo NO real (para .env.example). Vacío para claves' },
            },
            required: ['nombre'],
          },
        },
      },
      required: ['nombre', 'lenguaje'],
    },
    output: salidaTexto,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const r = await generar(cwd, args, cfg)
      const tarea = r.lenguaje === 'python' ? `${r.carpeta}/tarea.py` : `${r.carpeta}/src/main/java/automatizacion/Tarea.java`
      return [
        `Creada ${r.carpeta}/ (${r.lenguaje}, horario "${r.horario}" ${r.zonaHoraria}).`,
        `Lógica de negocio: ${tarea}`,
        `Archivos: ${r.archivos.join(', ')}`,
        '',
        `Siguiente: lee ${tarea} (trae un ejemplo con pasos, reintentos, modo prueba y "ya hecho") y reemplaza el ejemplo con la lógica real. ` +
          'Si necesita credenciales para probar, pide al usuario crear .env a partir de .env.example. Luego llama automatizacion_probar.',
      ].join('\n')
    },
  })

  ctx.tools.register({
    name: 'automatizacion_probar',
    description:
      'Compila (Java: Maven o javac) y ejecuta una automatización de automatizaciones/<nombre>/. Por defecto en modo PRUEBA (no envía ni modifica nada externo). ' +
      'Devuelve el registro de la ejecución (estado, pasos, error, resultado) y la salida de consola para corregir. ' +
      'Usa modo "real" SOLO si el usuario lo pidió explícitamente en este turno.',
    timeoutMs: 30 * 60_000,
    parameters: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        modo: { type: 'string', enum: ['prueba', 'real'], description: 'Por defecto prueba' },
        forzar: { type: 'boolean', description: 'Ignorar lo marcado como "ya hecho"' },
      },
      required: ['nombre'],
    },
    output: salidaTexto,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      return textoPrueba(await probar(cwd, args, { signal: exec.signal, minutos: cfg.minutosPrueba, carpeta: cfg.carpeta }))
    },
  })

  ctx.tools.register({
    name: 'automatizacion_ejecuciones',
    description:
      'Historial de ejecuciones de una automatización (estado, duración, paso que falló, error, resultado) desde logs/ejecuciones.jsonl. ' +
      'Sin nombre, lista las automatizaciones del proyecto con su última ejecución. Útil para revisar qué pasó anoche en el servidor si el usuario trae la carpeta logs/.',
    parameters: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        cuantas: { type: 'number', description: 'Por defecto 10' },
      },
    },
    output: salidaTexto,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      if (!args.nombre) {
        const lista = await listarAutomatizaciones(cwd, cfg.carpeta)
        if (!lista.length) return `No hay automatizaciones en ${cfg.carpeta}/ todavía.`
        return lista.map((a) => `- ${a.nombre} (${a.lenguaje}): ${a.ultima ? `última ${a.ultima.inicio} · ${a.ultima.modo} · ${a.ultima.estado}${a.ultima.error ? ' — ' + a.ultima.error : ''}` : 'nunca se ha ejecutado'}`).join('\n')
      }
      const dir = path.join(cwd, cfg.carpeta, slug(args.nombre))
      if (!existsSync(dir)) throw new Error(`no existe ${cfg.carpeta}/${slug(args.nombre)}`)
      const r = resumenEjecuciones(await leerEjecuciones(dir, Math.min(100, Math.max(1, Number(args.cuantas) || 10))))
      if (!r.total) return 'Todavía no hay ejecuciones registradas.'
      return [
        `${r.total} ejecuciones (${r.reales} reales, éxito en reales: ${r.exitoReales}, promedio ${r.duracionPromedio} s). Más reciente primero:`,
        ...r.ejecuciones.map((e) => `- ${e.inicio} · ${e.modo} · ${e.estado} · ${e.segundos} s${e.error ? ` — falló en "${e.pasoFallido ?? '?'}": ${e.error}` : ` · ${JSON.stringify(e.resultado ?? {})}`}`),
      ].join('\n')
    },
  })
}
