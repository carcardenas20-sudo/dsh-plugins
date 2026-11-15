// dsh-transcriptor — voz a texto dentro de DeepSeek Harness, todo en el computador del usuario.
//
// - Grabaciones (reuniones, notas de voz, audios de WhatsApp, videos) → texto con marcas de tiempo
//   en transcripciones/<nombre>.md. Las partes que no se oyeron bien quedan marcadas con ⚠.
// - Dictado: una página local con botón de grabar; lo dictado le llega al agente cuando el
//   usuario escribe "dictado" en Harness.
// - Motor: Whisper (faster-whisper) en un entorno propio de Python, con el vocabulario del
//   proyecto (nombres propios, siglas) para que no los escriba mal. El audio no sale del PC.

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pagina } from './pagina.js'

export const name = 'transcriptor'
export const inject = ['tools', 'workingDirectory', 'systemPrompt']

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const DEFAULTS = {
  modelo: 'large-v3-turbo', // el más preciso que corre bien sin tarjeta gráfica. Más rápido y menos preciso: "small"
  modeloDictado: null, // por defecto el mismo; pon "small" si el dictado te parece lento
  idioma: 'es',
  dispositivo: 'auto', // auto | cpu | cuda
  carpeta: 'transcripciones',
  carpetaMotor: null, // por defecto ~/.dsh-transcriptor
  python: null, // ruta a un Python que ya tenga faster-whisper (se salta la instalación)
  puerto: 47822,
  esperaSegundos: 240, // cuánto espera la herramienta antes de dejar el trabajo en segundo plano
  maxAudioMB: 1024,
}
const SOURCE_KIND = 'dsh-transcriptor'

// ---------- utilidades puras ----------

export const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\.[a-z0-9]{2,5}$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'audio'

export const reloj = (seg) => {
  const s = Math.max(0, Math.floor(seg))
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':')
}

/** Un segmento es dudoso si el modelo no estaba seguro, se repite demasiado o cree que era silencio. */
export const esDudoso = (s) => s.logprob < -1.0 || s.compresion > 2.4 || (s.silencio > 0.6 && s.logprob < -0.5)

export const textoPlano = (segs) => segs.map((s) => s.t.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

/** Párrafos con marca de tiempo; corta cuando hay una pausa o el párrafo ya es largo. */
export function parrafos(segs, { pausa = 1.5, maxLargo = 520 } = {}) {
  const out = []
  let act = null
  for (const s of segs) {
    const t = esDudoso(s) ? `⚠[${s.t.trim()}]` : s.t.trim()
    if (!t) continue
    if (act && s.i - act.fin <= pausa && act.texto.length + t.length <= maxLargo) { act.texto += ` ${t}`; act.fin = s.f } else { act = { inicio: s.i, fin: s.f, texto: t }; out.push(act) }
  }
  return out
}

export function aMarkdown(res, meta) {
  const dudosos = res.segmentos.filter(esDudoso).length
  const l = [
    `# Transcripción: ${meta.nombre}`,
    '',
    `- Archivo: ${meta.archivo}`,
    `- Duración: ${reloj(res.duracion)} · Idioma: ${res.idioma ?? '?'} · Modelo: ${res.modelo ?? '?'} (${res.dispositivo === 'cuda' ? 'tarjeta gráfica' : 'procesador'})`,
    `- Transcrito: ${meta.fecha}`,
    dudosos ? `- **${dudosos} parte(s) dudosa(s)** marcadas con ⚠[…]: no se oyeron bien; conviene escucharlas en el minuto indicado.` : '- Sin partes dudosas.',
    '',
    '> Transcripción automática hecha en este computador. No modifiques este archivo para resumir: los resúmenes van en un archivo aparte.',
    '',
  ]
  const ps = parrafos(res.segmentos)
  if (!ps.length) l.push('_(No se detectó voz en el audio.)_')
  for (const p of ps) l.push(`**[${reloj(p.inicio)}]** ${p.texto}`, '')
  return l.join('\n')
}

/** Nombres propios y siglas del proyecto, para que el modelo los escriba bien. */
export function vocabularioDe(textos, propias = [], max = 700) {
  const cuenta = new Map()
  for (const t of textos) {
    for (const m of String(t ?? '').matchAll(/(?<![\p{L}\d])(\p{Lu}[\p{Ll}]+(?:\p{Lu}[\p{Ll}]+)+|\p{Lu}{3,}|\p{Lu}[\p{Ll}]{3,})(?![\p{L}\d])/gu)) {
      const w = m[1]
      if (COMUNES.has(w.toLowerCase())) continue
      cuenta.set(w, (cuenta.get(w) ?? 0) + (/^\p{Lu}{3,}$|\p{Ll}\p{Lu}/u.test(w) ? 2 : 1))
    }
  }
  const auto = [...cuenta.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([w]) => w)
  const todas = [...new Set([...propias.map((p) => p.trim()).filter(Boolean), ...auto])]
  let out = ''
  for (const w of todas) { if (out.length + w.length + 2 > max) break; out += (out ? ', ' : '') + w }
  return out
}
const COMUNES = new Set('para pero como cuando donde esta este esto estos estas todo todos toda todas cada desde hasta entre sobre luego antes después también además solo sólo sino aunque porque regla reglas nota notas ejemplo datos lista tabla campo campos módulo módulos pantalla pantallas etapa origen nuevo nueva tipo tipos estado fecha nombre rol roles decisión decisiones pendiente pendientes proyecto stack estructura memoria resumen usuario usuarios sistema archivo archivos carpeta descripción qué cómo sin con los las una uno unos unas del the and for this that with from true false null none todo'.split(' '))

export const pideDictado = (t) => /^\s*(usa |lee |toma |pega )?(mi |el |lo )?(dictado|dict[eé]|que dict[eé])\s*[.!]*\s*$/iu.test(String(t ?? '')) || /\[dictado\]/i.test(String(t ?? ''))

const deepFreeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v) } return v }
const recall = (text) => deepFreeze({ role: 'user', id: globalThis.crypto.randomUUID(), content: [{ type: 'text', text }], source: { kind: SOURCE_KIND, form: 'recall' } })

function correr(cmd, args, { timeoutMs = 60_000, signal, env } = {}) {
  return new Promise((resolve) => {
    let salida = ''
    let h
    try { h = spawn(cmd, args, { windowsHide: true, signal, env: { ...process.env, ...env } }) } catch (e) { return resolve({ codigo: null, salida: String(e.message) }) }
    const t = setTimeout(() => h.kill(), timeoutMs)
    const mas = (b) => { salida += b.toString('utf8'); if (salida.length > 60_000) salida = salida.slice(-30_000) }
    h.stdout.on('data', mas); h.stderr.on('data', mas)
    h.on('error', (e) => { clearTimeout(t); resolve({ codigo: null, salida: salida + String(e.message) }) })
    h.on('close', (codigo) => { clearTimeout(t); resolve({ codigo, salida }) })
  })
}

const REGLAS = [
  '## Transcriptor (dsh-transcriptor)',
  'To turn audio or video into text (meetings, voice notes, WhatsApp audios), call transcribir with the file path; it runs locally on this computer. If it reports that the engine is missing, tell the user it needs a one-time install (Python package faster-whisper plus a ~1.6 GB model download) and, once they agree, call transcriptor_preparar.',
  'The transcript file in transcripciones/ is a faithful record: never rewrite, "clean" or summarize it in place. Put summaries, minutes or action items in a separate file and keep the ⚠[…] marks: they flag parts that were not heard clearly, so mention them to the user instead of guessing.',
  'Long recordings keep running in the background: use transcripcion_estado to check, do not call transcribir again for the same file.',
  'For voice dictation, call dictado_abrir and give the user the link. A message tagged [Dictado] is what the user said out loud: treat it exactly as their typed message (it may contain small recognition errors; ask if something is unclear).',
  'If proper nouns or project terms come out misspelled, add them with transcriptor_vocabulario so they are recognized next time.',
].join('\n')

// ---------- plugin ----------

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const dirMotor = cfg.carpetaMotor ?? path.join(homedir(), '.dsh-transcriptor')
  const pyVenv = process.platform === 'win32' ? path.join(dirMotor, 'venv', 'Scripts', 'python.exe') : path.join(dirMotor, 'venv', 'bin', 'python')
  const pythonMotor = () => cfg.python ?? pyVenv
  const hayMotor = () => (cfg.python ? true : existsSync(pyVenv))

  // ----- proceso del motor -----
  let proc = null, arrancando = null
  const esperando = new Map() // id → {ok, mal, progreso}
  let sec = 0

  function arrancar() {
    if (proc) return Promise.resolve()
    if (arrancando) return arrancando
    if (!hayMotor()) return Promise.reject(new Error('MOTOR_FALTA'))
    arrancando = new Promise((ok, mal) => {
      const h = spawn(pythonMotor(), ['-u', path.join(AQUI, 'motor.py')], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', DSH_TRANSCRIPTOR_DISPOSITIVO: cfg.dispositivo, HF_HUB_DISABLE_SYMLINKS_WARNING: '1' },
      })
      let listo = false, errores = ''
      const t = setTimeout(() => { if (!listo) { h.kill(); mal(new Error('el motor no arrancó en 90 s')) } }, 90_000)
      h.stderr.on('data', (b) => { errores = (errores + b.toString('utf8')).slice(-4000) })
      createInterface({ input: h.stdout }).on('line', (linea) => {
        let m
        try { m = JSON.parse(linea) } catch { return }
        if (m.tipo === 'listo') { listo = true; clearTimeout(t); proc = h; ok(); return }
        if (m.tipo === 'sin-motor') { clearTimeout(t); mal(new Error('MOTOR_FALTA')); return }
        const e = esperando.get(m.id)
        if (!e) return
        if (m.tipo === 'progreso') e.progreso?.(m.pct)
        else if (m.tipo === 'fin') { esperando.delete(m.id); e.ok(m) }
        else if (m.tipo === 'error') { esperando.delete(m.id); e.mal(new Error(m.mensaje)) }
      })
      const caer = (motivo) => {
        clearTimeout(t)
        if (proc === h) proc = null
        for (const [id, e] of esperando) { esperando.delete(id); e.mal(new Error(`el motor se cerró (${motivo})${errores ? `: ${errores.split('\n').filter(Boolean).slice(-2).join(' ')}` : ''}`)) }
        if (!listo) mal(new Error(`no se pudo iniciar el motor (${motivo})`))
      }
      h.on('error', (e) => caer(e.message))
      h.on('exit', (c) => caer(`código ${c}`))
    }).finally(() => { arrancando = null })
    return arrancando
  }

  async function ordenar(orden, progreso) {
    await arrancar()
    const id = String(++sec)
    return new Promise((ok, mal) => {
      esperando.set(id, { ok, mal, progreso })
      proc.stdin.write(`${JSON.stringify({ ...orden, id })}\n`)
    })
  }

  // ----- trabajos -----
  const trabajos = [] // {id, cwd, nombre, archivo, salida, estado, pct, error, dudosos, duracion, promesa}
  let secTrabajo = 0

  async function vocabulario(cwd) {
    const leer = async (f) => { try { return await readFile(path.join(cwd, f), 'utf8') } catch { return '' } }
    const propias = (await leer('.dsh-transcriptor/vocabulario.txt')).split('\n')
    return vocabularioDe([await leer('AGENTS.md'), await leer('docs/MAPA-SISTEMA.md')], propias)
  }

  function encolar(cwd, archivo, { modelo, idioma, salidaRel, nombre }) {
    const t = { id: ++secTrabajo, cwd, nombre: nombre ?? path.basename(archivo), archivo, salida: salidaRel, estado: 'en cola', pct: 0 }
    t.promesa = (async () => {
      const voc = await vocabulario(cwd)
      t.estado = 'transcribiendo'
      const res = await ordenar({ op: 'transcribir', archivo, idioma: idioma === 'auto' ? null : (idioma ?? cfg.idioma), modelo: modelo ?? cfg.modelo, vocabulario: voc }, (p) => { t.pct = p })
      res.modelo = res.modelo ?? modelo ?? cfg.modelo
      t.dudosos = res.segmentos.filter(esDudoso).length
      t.duracion = res.duracion
      if (salidaRel) {
        const destino = path.join(cwd, salidaRel)
        await mkdir(path.dirname(destino), { recursive: true })
        await writeFile(destino, aMarkdown(res, { nombre: t.nombre, archivo: path.relative(cwd, archivo).startsWith('..') ? archivo : path.relative(cwd, archivo).split(path.sep).join('/'), fecha: new Date().toLocaleString('es-CO') }), 'utf8')
      }
      t.estado = 'listo'; t.pct = 100
      return res
    })().catch((e) => { t.estado = 'error'; t.error = e.message === 'MOTOR_FALTA' ? 'el motor de transcripción no está instalado (usa transcriptor_preparar)' : e.message; throw e })
    t.promesa.catch(() => {})
    trabajos.push(t)
    if (trabajos.length > 40) trabajos.splice(0, trabajos.length - 40)
    return t
  }

  const lineaTrabajo = (t) => `#${t.id} ${t.nombre}: ${t.estado}${t.estado === 'transcribiendo' ? ` (${t.pct}%)` : ''}${t.estado === 'listo' ? ` — ${reloj(t.duracion ?? 0)} de audio${t.dudosos ? `, ${t.dudosos} parte(s) dudosa(s)` : ''}${t.salida ? ` → ${t.salida}` : ''}` : ''}${t.error ? ` — ${t.error}` : ''}`

  // ----- dictado: página local -----
  const proyectos = new Map() // token → cwd
  const dictados = new Map() // cwd → {id, texto, dudosos}
  let servidor = null, puertoReal = null

  const tokenDe = (cwd) => { for (const [k, v] of proyectos) if (v === cwd) return k; const k = randomBytes(12).toString('hex'); proyectos.set(k, cwd); return k }

  function cuerpo(req, maxBytes) {
    return new Promise((ok, mal) => {
      const partes = []
      let n = 0
      req.on('data', (b) => { n += b.length; if (n > maxBytes) { mal(new Error('el archivo es demasiado grande')); req.destroy() } else partes.push(b) })
      req.on('end', () => ok(Buffer.concat(partes)))
      req.on('error', mal)
    })
  }

  async function atender(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1')
    const m = /^\/d\/([0-9a-f]{24})(\/[a-z]*)?\/?$/.exec(url.pathname)
    const json = (codigo, obj) => { res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)) }
    const cwd = m && proyectos.get(m[1])
    if (!cwd) return json(404, { error: 'enlace no válido: pide uno nuevo con dictado_abrir' })
    const origen = req.headers.origin
    if (origen && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origen)) return json(403, { error: 'origen no permitido' })
    const ruta = m[2] ?? '/'
    try {
      if (req.method === 'GET' && ruta === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(pagina(path.basename(cwd).replace(/[<>&"]/g, ''))) }
      if (req.method === 'GET' && ruta === '/estado') return json(200, { motor: hayMotor() })
      if (req.method === 'POST' && ruta === '/audio') {
        const datos = await cuerpo(req, 200 * 1024 * 1024)
        const ext = /ogg/.test(req.headers['content-type'] ?? '') ? 'ogg' : /mp4|m4a/.test(req.headers['content-type'] ?? '') ? 'm4a' : /wav/.test(req.headers['content-type'] ?? '') ? 'wav' : 'webm'
        const tmp = path.join(tmpdir(), `dsh-dictado-${Date.now()}-${randomBytes(3).toString('hex')}.${ext}`)
        await writeFile(tmp, datos)
        const t = encolar(cwd, tmp, { modelo: cfg.modeloDictado ?? cfg.modelo, nombre: 'dictado' })
        const r = await t.promesa
        const texto = textoPlano(r.segmentos)
        rm(tmp, { force: true }).catch(() => {})
        const previo = dictados.get(cwd)
        const d = { id: t.id, texto: [previo?.texto, texto].filter(Boolean).join('\n'), dudosos: (previo?.dudosos ?? 0) + t.dudosos }
        if (texto) {
          dictados.set(cwd, d)
          const f = path.join(cwd, cfg.carpeta, 'dictados', `${new Date().toISOString().slice(0, 10)}.md`)
          await mkdir(path.dirname(f), { recursive: true })
          await appendFile(f, `**[${new Date().toLocaleTimeString('es-CO')}]** ${texto}\n\n`, 'utf8')
        }
        return json(200, { id: t.id, texto, dudosos: t.dudosos })
      }
      if (req.method === 'PUT' && ruta === '/dictado') {
        const j = JSON.parse((await cuerpo(req, 1024 * 1024)).toString('utf8'))
        const texto = String(j.texto ?? '').trim()
        if (texto) dictados.set(cwd, { id: dictados.get(cwd)?.id ?? 0, texto, dudosos: 0 }); else dictados.delete(cwd)
        return json(200, { ok: true })
      }
      if (req.method === 'DELETE' && ruta === '/dictado') { dictados.delete(cwd); return json(200, { ok: true }) }
      if (req.method === 'POST' && ruta === '/archivo') {
        const nombre = path.basename(String(url.searchParams.get('nombre') ?? 'audio')).replace(/[^\p{L}\d._ -]/gu, '_').slice(0, 120) || 'audio'
        const datos = await cuerpo(req, cfg.maxAudioMB * 1024 * 1024)
        const destino = path.join(cwd, cfg.carpeta, 'audios', nombre)
        await mkdir(path.dirname(destino), { recursive: true })
        await writeFile(destino, datos)
        const salida = path.posix.join(cfg.carpeta, `${slug(nombre)}.md`)
        encolar(cwd, destino, { salidaRel: salida, nombre })
        return json(200, { salida })
      }
      return json(404, { error: 'no existe' })
    } catch (e) {
      return json(500, { error: e.message === 'MOTOR_FALTA' ? 'el motor de transcripción no está instalado; pídele a DeepSeek «prepara el transcriptor»' : e.message })
    }
  }

  async function abrirServidor() {
    if (servidor) return puertoReal
    for (let i = 0; i < 6; i++) {
      const s = createServer((req, res) => { atender(req, res).catch(() => { try { res.writeHead(500); res.end() } catch {} }) })
      const ok = await new Promise((r) => { s.once('error', () => r(false)); s.listen(cfg.puerto + i, '127.0.0.1', () => r(true)) })
      if (ok) { servidor = s; puertoReal = cfg.puerto === 0 ? s.address().port : cfg.puerto + i; return puertoReal }
    }
    throw new Error(`no pude abrir la página de dictado: los puertos ${cfg.puerto}–${cfg.puerto + 5} están ocupados`)
  }

  ctx.effect?.(() => () => { try { proc?.stdin.write('{"op":"salir"}\n'); proc?.kill() } catch {} try { servidor?.closeAllConnections?.(); servidor?.close() } catch {} servidor = null; proc = null })

  ctx.systemPrompt.section({ name: 'transcriptor', order: 2480, interpolate: false, text: REGLAS })

  // "dictado" en el chat → lo que el usuario dijo en voz alta.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter' || !payload.agent) return decision
    try {
      const usuario = (decision.messages ?? []).filter((m) => m?.source?.kind === 'user')
      const texto = usuario.map((m) => (m.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n')).join('\n')
      if (!pideDictado(texto)) return decision
      const cwd = await ctx.workingDirectory.ensure(payload.agent, payload.signal)
      const d = dictados.get(cwd)
      const extra = d?.texto
        ? `[Dictado] El usuario dictó esto por voz; trátalo como su mensaje escrito${d.dudosos ? ` (ojo: ${d.dudosos} parte(s) no se oyeron bien; si algo no tiene sentido, pregunta)` : ''}:\n\n${d.texto}`
        : '[Dictado] El usuario pidió usar su dictado, pero no hay ninguno pendiente. Dile que dicte en la página de dictado (llama dictado_abrir para darle el enlace) y vuelva a escribir "dictado".'
      if (d?.texto) dictados.delete(cwd)
      const msgs = [...decision.messages]
      let i = -1
      msgs.forEach((m, k) => { if (m?.source?.kind === 'user') i = k })
      msgs.splice(i + 1, 0, recall(extra))
      return { ...decision, messages: msgs }
    } catch { return decision }
  })

  const salida = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }
  const FALTA = 'El motor de transcripción no está instalado en este computador. Explícale al usuario que se instala una sola vez (un entorno de Python con faster-whisper, y la descarga del modelo de ~1,6 GB) y, si está de acuerdo, llama transcriptor_preparar.'

  ctx.tools.register({
    name: 'transcriptor_preparar',
    description: 'Instala el motor de transcripción local (una sola vez): crea un entorno de Python propio en la carpeta del usuario, instala faster-whisper y descarga el modelo (~1,6 GB). Necesita Python 3.9+ e internet. No toca Harness ni el proyecto. Úsala solo con el visto bueno del usuario.',
    timeoutMs: 60 * 60_000,
    parameters: { type: 'object', properties: { descargarModelo: { type: 'boolean', description: 'Descargar el modelo ahora (por defecto sí). Si no, se descarga en la primera transcripción.' } } },
    output: salida,
    async execute(args, exec) {
      const pasos = []
      if (cfg.python) pasos.push(`Se usa el Python configurado: ${cfg.python}`)
      else if (existsSync(pyVenv)) pasos.push('El entorno ya existía.')
      else {
        let base = null
        for (const [cmd, pre] of [['py', ['-3']], ['python', []], ['python3', []]]) {
          const r = await correr(cmd, [...pre, '-c', 'import sys;print(sys.version_info[0]*100+sys.version_info[1])'], { timeoutMs: 20_000, signal: exec?.signal })
          if (r.codigo === 0 && Number(r.salida.trim()) >= 309) { base = [cmd, pre]; break }
        }
        if (!base) return 'No encontré Python 3.9 o más nuevo en este computador. Instálalo desde python.org (marca "Add python.exe to PATH") y vuelve a intentarlo.'
        await mkdir(dirMotor, { recursive: true })
        const v = await correr(base[0], [...base[1], '-m', 'venv', path.join(dirMotor, 'venv')], { timeoutMs: 5 * 60_000, signal: exec?.signal })
        if (v.codigo !== 0 || !existsSync(pyVenv)) return `No pude crear el entorno de Python:\n${v.salida.slice(-1500)}`
        pasos.push(`Entorno creado en ${path.join(dirMotor, 'venv')}`)
      }
      if (!cfg.python) {
        const p = await correr(pyVenv, ['-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check', 'faster-whisper', 'av>=12,<16'], { timeoutMs: 30 * 60_000, signal: exec?.signal })
        if (p.codigo !== 0) return `No pude instalar faster-whisper (¿hay internet?):\n${p.salida.slice(-1500)}`
        pasos.push('faster-whisper instalado.')
      }
      try { proc?.kill() } catch {}
      proc = null
      try { await ordenar({ op: 'probar' }); pasos.push('El motor arranca y sabe leer audio.') } catch (e) { return `${pasos.join('\n')}\nEl motor quedó instalado pero no pasa la prueba de lectura de audio: ${e.message === 'MOTOR_FALTA' ? 'no se pudo importar faster-whisper' : e.message}` }
      if (args?.descargarModelo !== false) {
        try { await ordenar({ op: 'cargar', modelo: cfg.modelo }); pasos.push(`Modelo ${cfg.modelo} descargado y cargado.`) } catch (e) { return `${pasos.join('\n')}\nNo pude descargar o cargar el modelo ${cfg.modelo}: ${e.message}` }
      }
      return `${pasos.join('\n')}\nListo: ya se puede transcribir y dictar.`
    },
  })

  ctx.tools.register({
    name: 'transcribir',
    description: 'Transcribe un audio o video (mp3, m4a, wav, ogg/opus de WhatsApp, mp4, webm…) a texto, en este computador. Guarda transcripciones/<nombre>.md con marcas de tiempo y marca con ⚠[…] lo que no se oyó bien. Las grabaciones largas siguen en segundo plano (consulta con transcripcion_estado).',
    timeoutMs: (DEFAULTS.esperaSegundos + 60) * 1000,
    parameters: {
      type: 'object',
      properties: {
        archivo: { type: 'string', description: 'Ruta del audio: dentro del proyecto o ruta completa (por ejemplo en Descargas)' },
        idioma: { type: 'string', description: 'Código de idioma (es, en…) o "auto". Por defecto es' },
        modelo: { type: 'string', description: 'Opcional: large-v3-turbo (por defecto), large-v3 (más lento, algo más preciso), medium, small' },
      },
      required: ['archivo'],
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const archivo = path.resolve(cwd, String(args.archivo ?? ''))
      if (!existsSync(archivo)) throw new Error(`no existe el archivo ${args.archivo}`)
      if (!hayMotor()) return FALTA
      const ya = trabajos.find((t) => t.archivo === archivo && (t.estado === 'en cola' || t.estado === 'transcribiendo'))
      const t = ya ?? encolar(cwd, archivo, { modelo: args.modelo, idioma: args.idioma, salidaRel: path.posix.join(cfg.carpeta, `${slug(path.basename(archivo))}.md`) })
      let timer
      const fin = await Promise.race([t.promesa.then(() => 'fin', (e) => e), new Promise((r) => { timer = setTimeout(() => r('espera'), cfg.esperaSegundos * 1000) })])
      clearTimeout(timer)
      if (fin === 'espera') return `La transcripción sigue en curso (${t.pct}%) en segundo plano y quedará en ${t.salida}. Consulta con transcripcion_estado; no la lances de nuevo.`
      if (fin !== 'fin') return fin.message === 'MOTOR_FALTA' ? FALTA : `No se pudo transcribir: ${fin.message}`
      const md = await readFile(path.join(cwd, t.salida), 'utf8')
      return `Transcripción lista: ${t.salida} (${reloj(t.duracion)} de audio${t.dudosos ? `, ${t.dudosos} parte(s) dudosa(s) marcadas con ⚠` : ', sin partes dudosas'}).\n\n${md.length > 9000 ? `${md.slice(0, 9000)}\n… (continúa en el archivo)` : md}`
    },
  })

  ctx.tools.register({
    name: 'transcripcion_estado',
    description: 'Estado de las transcripciones de esta sesión (en cola, avance, listas, con error) y dónde quedó cada una.',
    parameters: { type: 'object', properties: {} },
    output: salida,
    async execute(_a, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const l = trabajos.filter((t) => t.cwd === cwd && t.nombre !== 'dictado')
      return l.length ? l.map(lineaTrabajo).join('\n') : 'No hay transcripciones en esta sesión.'
    },
  })

  ctx.tools.register({
    name: 'transcriptor_vocabulario',
    description: 'Palabras que el transcriptor debe reconocer y escribir bien en este proyecto (nombres de personas, empresas, productos, siglas). accion: "agregar" (palabras), "listar", "quitar" (palabras). Además toma solo los nombres propios de la memoria y del mapa del proyecto.',
    parameters: { type: 'object', properties: { accion: { type: 'string', enum: ['agregar', 'listar', 'quitar'] }, palabras: { type: 'array', items: { type: 'string' } } }, required: ['accion'] },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const f = path.join(cwd, '.dsh-transcriptor', 'vocabulario.txt')
      let lista = []
      try { lista = (await readFile(f, 'utf8')).split('\n').map((x) => x.trim()).filter(Boolean) } catch {}
      const nuevas = (args.palabras ?? []).map((x) => String(x).replace(/[\r\n,]+/g, ' ').trim()).filter(Boolean)
      if (args.accion === 'agregar') lista = [...new Set([...lista, ...nuevas])]
      if (args.accion === 'quitar') lista = lista.filter((x) => !nuevas.some((n) => n.toLowerCase() === x.toLowerCase()))
      if (args.accion !== 'listar') { await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, `${lista.join('\n')}\n`, 'utf8') }
      return `Vocabulario propio (${lista.length}): ${lista.join(', ') || '(vacío)'}\nSe le pasa al transcriptor: ${await vocabulario(cwd) || '(nada)'}`
    },
  })

  ctx.tools.register({
    name: 'dictado_abrir',
    description: 'Devuelve el enlace de la página local de dictado de este proyecto: un botón para hablar y ver el texto, y una zona para arrastrar grabaciones. Dale el enlace al usuario para que lo abra en su navegador. Lo que dicte te llega cuando escriba "dictado".',
    parameters: { type: 'object', properties: {} },
    output: salida,
    async execute(_a, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const puerto = await abrirServidor()
      return `Página de dictado: http://127.0.0.1:${puerto}/d/${tokenDe(cwd)}/\nÁbrela en el navegador de este computador (pide permiso de micrófono la primera vez). Para usar lo dictado, escribe "dictado" en Harness.${hayMotor() ? '' : '\nOjo: el motor aún no está instalado; hay que correr transcriptor_preparar primero.'}`
    },
  })
}
