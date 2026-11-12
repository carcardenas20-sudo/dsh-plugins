// dsh-rea — REA (Reverse Engineer Anything, github.com/morluto/rea) en DeepSeek Harness
// sin cargar sus 229 herramientas en cada llamada al modelo.
//
// Conectar REA como servidor MCP normal le manda al modelo unos 70.000 tokens de
// descripciones en cada paso. Este plugin registra solo tres herramientas livianas:
//   rea_buscar  → encuentra las herramientas de REA que sirven para la tarea (con su esquema)
//   rea_llamar  → ejecuta una herramienta de REA por nombre
//   rea_guia    → el método de trabajo de REA (skill oficial y referencias)
// REA se arranca solo la primera vez que se usa y se cierra con dsh.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const name = 'rea'
export const inject = ['tools']

const DEFAULTS = {
  comando: undefined, // ejecutable; por defecto el mismo Node que corre dsh
  args: undefined, // por defecto [<rea.mjs>, 'mcp']
  script: undefined, // ruta a rea-agents/scripts/rea.mjs si no está instalado globalmente
  env: {},
  usarNpx: true, // si no encuentra REA instalado, usar `npx -y rea-agents@<version> mcp`
  versionNpx: '6.8.0',
  timeoutSegundos: 600,
  arranqueSegundos: 120,
  maxCaracteres: 40000,
  maxResultados: 6,
}

const PROTOCOLO = '2025-06-18'

// ---------- utilidades ----------

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const primeraFrase = (s) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  const i = t.search(/[.!?](\s|$)/)
  return (i > 0 && i < 240 ? t.slice(0, i + 1) : t.slice(0, 240))
}
const recortar = (t, max) => t.length <= max ? t : `${t.slice(0, max)}\n\n[… recortado: ${t.length - max} caracteres más. Pide algo más específico (rango, filtro, límite) para ver el resto.]`

// Sinónimos en español → términos que usa REA en inglés.
const SINONIMOS = {
  pagina: ['web', 'browser', 'page', 'website'], web: ['browser', 'website', 'http'], sitio: ['website', 'web', 'browser'],
  navegador: ['browser'], red: ['network', 'capture', 'http'], peticiones: ['network', 'request', 'http'],
  binario: ['native', 'binary'], ejecutable: ['native', 'binary', 'executable'], funcion: ['procedure', 'function'],
  descompilar: ['decompile', 'pseudo'], decompilar: ['decompile', 'pseudo'], cadenas: ['strings'], texto: ['strings'],
  escritorio: ['desktop', 'electron'], aplicacion: ['application', 'app'], app: ['application'],
  android: ['android', 'apk', 'jadx'], apk: ['android', 'apk'], javascript: ['javascript', 'js', 'electron', 'asar'],
  configuracion: ['settings', 'provider'], proveedor: ['provider'], memoria: ['memory', 'runtime'],
  ejecucion: ['runtime', 'process'], proceso: ['process', 'runtime'], comparar: ['diff', 'compare'], version: ['diff', 'version'],
  firmware: ['firmware'], contrato: ['evm', 'contract'], dotnet: ['.net', 'dotnet', 'assembly', 'ilspy'], net: ['dotnet', '.net'],
}

function puntaje(tool, palabras) {
  const n = norm(tool.name)
  const d = norm(tool.description)
  let p = 0
  for (const w of palabras) {
    if (n.includes(w)) p += 5
    if (d.includes(w)) p += 1
  }
  return p
}

function terminos(consulta) {
  const base = norm(consulta).split(/[^a-z0-9.#_-]+/).filter((w) => w.length > 1)
  const out = new Set()
  for (const w of base) {
    out.add(w)
    for (const s of SINONIMOS[w] ?? []) out.add(s)
    if (w.includes('_')) for (const x of w.split('_')) if (x.length > 1) out.add(x)
  }
  return [...out]
}

// ---------- ubicar REA ----------

function candidatosScript() {
  const rel = path.join('rea-agents', 'scripts', 'rea.mjs')
  const out = []
  if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, 'npm', 'node_modules', rel))
  const dirNode = path.dirname(process.execPath)
  out.push(path.join(dirNode, 'node_modules', rel)) // nvm-windows, instalaciones portables
  out.push(path.join(dirNode, '..', 'lib', 'node_modules', rel)) // Linux/macOS
  if (process.env.npm_config_prefix) out.push(path.join(process.env.npm_config_prefix, 'lib', 'node_modules', rel), path.join(process.env.npm_config_prefix, 'node_modules', rel))
  if (process.env.HOME) out.push(path.join(process.env.HOME, '.npm-global', 'lib', 'node_modules', rel))
  return out
}

export function resolverComando(cfg) {
  if (cfg.comando) return { command: cfg.comando, args: cfg.args ?? ['mcp'], script: cfg.script, shell: false }
  const script = cfg.script ?? candidatosScript().find((p) => existsSync(p))
  if (script) return { command: process.execPath, args: cfg.args ?? [script, 'mcp'], script, shell: false }
  if (!cfg.usarNpx) return undefined
  return { command: 'npx', args: ['-y', `rea-agents@${cfg.versionNpx}`, 'mcp'], script: undefined, shell: process.platform === 'win32' }
}

// ---------- cliente MCP mínimo (stdio, JSON por línea) ----------

class ClienteMcp {
  constructor(cmd, cfg, logger) {
    this.cmd = cmd; this.cfg = cfg; this.logger = logger
    this.seq = 0; this.pendientes = new Map(); this.buffer = ''; this.stderr = ''
    this.instrucciones = ''; this.herramientas = []
    this.listo = this.arrancar()
    this.listo.catch(() => {})
  }

  async arrancar() {
    const { command, args, shell } = this.cmd
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell, windowsHide: true, env: { ...process.env, ...this.cfg.env } })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => this.leer(d))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-4000) })
    const fin = (motivo) => {
      if (this.cerrado) return
      this.cerrado = true
      const err = new Error(`REA se cerró (${motivo}).${this.stderr.trim() ? ` Últimos mensajes: ${this.stderr.trim().slice(-800)}` : ''}`)
      for (const p of this.pendientes.values()) p.reject(err)
      this.pendientes.clear()
    }
    child.on('error', (e) => fin(e.code === 'ENOENT' ? `no encontré "${command}"` : e.message))
    child.on('exit', (code, sig) => fin(sig ? `señal ${sig}` : `código ${code}`))
    child.stdin.on('error', () => {})

    const arranque = AbortSignal.timeout(this.cfg.arranqueSegundos * 1000)
    const init = await this.pedir('initialize', { protocolVersion: PROTOCOLO, capabilities: { roots: { listChanged: false } }, clientInfo: { name: 'dsh-rea', version: '0.1.0' } }, arranque)
    this.instrucciones = init?.instructions ?? ''
    this.notificar('notifications/initialized')
    const tools = []
    let cursor
    do {
      const r = await this.pedir('tools/list', cursor ? { cursor } : {}, arranque)
      tools.push(...(r?.tools ?? []))
      cursor = r?.nextCursor
    } while (cursor)
    this.herramientas = tools
    this.porNombre = new Map(tools.map((t) => [t.name, t]))
    return this
  }

  leer(d) {
    this.buffer += d
    let i
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const linea = this.buffer.slice(0, i).trim()
      this.buffer = this.buffer.slice(i + 1)
      if (!linea) continue
      let msg
      try { msg = JSON.parse(linea) } catch { continue }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && this.pendientes.has(msg.id)) {
        const p = this.pendientes.get(msg.id)
        this.pendientes.delete(msg.id)
        if (msg.error) p.reject(new Error(`REA: ${msg.error.message ?? JSON.stringify(msg.error)}`))
        else p.resolve(msg.result)
      } else if (msg.method && msg.id !== undefined) {
        this.responderServidor(msg)
      }
    }
  }

  responderServidor(msg) {
    if (msg.method === 'ping') return this.escribir({ jsonrpc: '2.0', id: msg.id, result: {} })
    if (msg.method === 'roots/list') return this.escribir({ jsonrpc: '2.0', id: msg.id, result: { roots: [] } })
    this.escribir({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `dsh-rea no soporta ${msg.method}` } })
  }

  escribir(obj) {
    if (this.cerrado) throw new Error('REA no está corriendo')
    this.child.stdin.write(JSON.stringify(obj) + '\n')
  }

  notificar(method, params) { this.escribir({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) }

  pedir(method, params, signal) {
    return new Promise((resolve, reject) => {
      if (this.cerrado) return reject(new Error('REA no está corriendo'))
      if (signal?.aborted) return reject(new Error(signal.reason?.name === 'TimeoutError' ? `REA no respondió a tiempo (${method})` : 'cancelado'))
      const id = ++this.seq
      const alAbortar = () => {
        if (!this.pendientes.has(id)) return
        this.pendientes.delete(id)
        try { this.notificar('notifications/cancelled', { requestId: id, reason: 'cancelado desde dsh' }) } catch {}
        const timeout = signal.reason?.name === 'TimeoutError'
        reject(new Error(timeout ? `REA no respondió a tiempo (${method})` : 'cancelado'))
      }
      this.pendientes.set(id, {
        resolve: (v) => { signal?.removeEventListener('abort', alAbortar); resolve(v) },
        reject: (e) => { signal?.removeEventListener('abort', alAbortar); reject(e) },
      })
      signal?.addEventListener('abort', alAbortar, { once: true })
      try { this.escribir({ jsonrpc: '2.0', id, method, params }) } catch (e) { this.pendientes.delete(id); reject(e) }
    })
  }

  cerrar() {
    if (!this.child || this.cerrado) return
    this.cerrado = true
    try { this.child.stdin.end() } catch {}
    const c = this.child
    setTimeout(() => { try { if (c.exitCode === null) c.kill() } catch {} }, 1500).unref?.()
  }
}

// ---------- resultados ----------

export function textoResultado(r, max) {
  const partes = []
  for (const b of r?.content ?? []) {
    if (b?.type === 'text') partes.push(b.text)
    else if (b?.type === 'image') partes.push(`[imagen ${b.mimeType ?? ''} omitida]`)
    else if (b?.type === 'resource_link') partes.push(`[recurso: ${b.name ?? ''} ${b.uri ?? ''}]`)
    else if (b?.type === 'resource') partes.push(b.resource?.text ?? `[recurso: ${b.resource?.uri ?? ''}]`)
  }
  let texto = partes.join('\n').trim()
  if (r?.structuredContent !== undefined && (!texto || texto.length < 40)) {
    texto = [texto, JSON.stringify(r.structuredContent, null, 1)].filter(Boolean).join('\n')
  }
  return recortar(texto || '(REA no devolvió contenido)', max)
}

const textOutput = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }

// ---------- plugin ----------

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}) }
  let cliente

  async function rea(signal) {
    if (cliente && !cliente.cerrado) {
      await cliente.listo
      return cliente
    }
    const cmd = resolverComando(cfg)
    if (!cmd) throw new Error('No encontré REA. Instálalo con: npm install -g rea-agents (o configura "script" con la ruta a rea.mjs).')
    cliente = new ClienteMcp(cmd, cfg, ctx.logger)
    try {
      await (signal ? Promise.race([cliente.listo, new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('cancelado')), { once: true }))]) : cliente.listo)
    } catch (e) {
      const c = cliente; cliente = undefined; c?.cerrar()
      throw new Error(`No pude arrancar REA (${cmd.command} ${cmd.args.join(' ')}): ${e?.message ?? e}`)
    }
    return cliente
  }

  ctx.effect?.(() => () => { cliente?.cerrar(); cliente = undefined }, 'rea.proceso')

  const reaBuscar = {
    name: 'rea_buscar',
    description:
      'Busca entre las 229 herramientas de REA (ingeniería inversa: binarios nativos, apps JavaScript/Electron, .NET, Android, firmware, sitios web y tráfico de red) ' +
      'y devuelve las que sirven con su esquema de argumentos. Úsala ANTES de rea_llamar. Escribe la tarea en pocas palabras, en inglés o español ' +
      '(por ejemplo "analyze javascript application", "decompile function", "capture website network"). Sin consulta lista todos los nombres.',
    parameters: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Qué quieres hacer, en pocas palabras. Vacío = listar todos los nombres.' },
        max: { type: 'number', description: `Cuántas herramientas devolver con esquema. Por defecto ${DEFAULTS.maxResultados}` },
      },
    },
    output: textOutput,
    timeoutMs: (DEFAULTS.arranqueSegundos + 30) * 1000,
    async execute(args, exec) {
      const c = await rea(exec?.signal)
      const consulta = String(args?.consulta ?? '').trim()
      if (!consulta) {
        return `REA tiene ${c.herramientas.length} herramientas:\n` + c.herramientas.map((t) => t.name).join(', ') + '\n\nUsa rea_buscar con una consulta para ver el esquema de las que te sirvan.'
      }
      const palabras = terminos(consulta)
      const max = Math.max(1, Math.min(20, Number(args?.max) || cfg.maxResultados))
      const exacta = c.porNombre.get(consulta)
      const ranking = c.herramientas
        .map((t) => ({ t, p: t === exacta ? 1e6 : puntaje(t, palabras) }))
        .filter((x) => x.p > 0)
        .sort((a, b) => b.p - a.p)
      if (!ranking.length) return `Ninguna herramienta de REA coincide con "${consulta}". Prueba otras palabras (en inglés suele funcionar mejor) o llama rea_buscar sin consulta para ver todos los nombres.`
      const top = ranking.slice(0, max)
      const resto = ranking.slice(max, max + 15).map((x) => x.t.name)
      const bloques = top.map(({ t }) => `### ${t.name}\n${String(t.description ?? '').trim().slice(0, 1200)}\nArgumentos (JSON Schema):\n${JSON.stringify(t.inputSchema ?? {}, null, 0)}`)
      return recortar([
        `Herramientas de REA para "${consulta}" (llámalas con rea_llamar):`,
        ...bloques,
        resto.length ? `También relacionadas: ${resto.join(', ')}` : '',
      ].filter(Boolean).join('\n\n'), cfg.maxCaracteres)
    },
  }

  const reaLlamar = {
    name: 'rea_llamar',
    description:
      'Ejecuta una herramienta de REA por su nombre exacto (obtenlo con rea_buscar) con sus argumentos según el esquema. ' +
      'Devuelve la evidencia que encontró REA. Si la herramienta acepta "detail": "summary", úsalo para resultados grandes y luego consulta las partes que necesites. ' +
      'Solo para software propio o con permiso para analizarlo.',
    parameters: {
      type: 'object',
      properties: {
        herramienta: { type: 'string', description: 'Nombre exacto de la herramienta de REA, por ejemplo "analyze_javascript_application"' },
        argumentos: { type: 'object', description: 'Argumentos según el esquema que mostró rea_buscar', additionalProperties: true },
      },
      required: ['herramienta'],
    },
    output: textOutput,
    timeoutMs: (DEFAULTS.timeoutSegundos + DEFAULTS.arranqueSegundos) * 1000,
    async execute(args, exec) {
      const c = await rea(exec?.signal)
      const nombre = String(args?.herramienta ?? '').trim()
      if (!c.porNombre.has(nombre)) {
        const parecidas = c.herramientas
          .map((t) => ({ n: t.name, p: puntaje(t, terminos(nombre.replace(/_/g, ' '))) }))
          .filter((x) => x.p > 0).sort((a, b) => b.p - a.p).slice(0, 8).map((x) => x.n)
        throw new Error(`REA no tiene una herramienta llamada "${nombre}".${parecidas.length ? ` Quizás: ${parecidas.join(', ')}.` : ''} Usa rea_buscar.`)
      }
      const timeout = AbortSignal.timeout(cfg.timeoutSegundos * 1000)
      const signal = exec?.signal ? AbortSignal.any([exec.signal, timeout]) : timeout
      const r = await c.pedir('tools/call', { name: nombre, arguments: args?.argumentos ?? {} }, signal)
      const texto = textoResultado(r, cfg.maxCaracteres)
      if (r?.isError) throw new Error(`REA (${nombre}) respondió con error:\n${texto}`)
      return texto
    },
  }

  const reaGuia = {
    name: 'rea_guia',
    description:
      'Devuelve el método de trabajo oficial de REA (cómo investigar una función de una app, qué evidencia mostrar y cómo reconstruirla). ' +
      'Léela al empezar una investigación. Con "tema" devuelve una referencia específica (por ejemplo "javascript-applications", "android-applications", "runtime-observation").',
    parameters: {
      type: 'object',
      properties: { tema: { type: 'string', description: 'Vacío = guía principal. Si no, nombre de la referencia.' } },
    },
    output: textOutput,
    timeoutMs: (DEFAULTS.arranqueSegundos + 30) * 1000,
    async execute(args, exec) {
      const c = await rea(exec?.signal)
      const script = c.cmd.script
      const dirSkill = script ? path.join(path.dirname(script), '..', 'skills', 'reverse-engineer-anything') : undefined
      const refs = dirSkill && existsSync(path.join(dirSkill, 'references')) ? readdirSync(path.join(dirSkill, 'references')).filter((f) => f.endsWith('.md')) : []
      const tema = norm(args?.tema).trim()
      const nota = 'Nota de dsh-rea: en este entorno las herramientas de REA no aparecen directas; búscalas con rea_buscar y ejecútalas con rea_llamar.'
      if (tema) {
        const f = refs.find((x) => norm(x).replace(/\.md$/, '') === tema) ?? refs.find((x) => norm(x).includes(tema))
        if (!f) return `No hay una referencia "${args.tema}". Disponibles: ${refs.map((x) => x.replace(/\.md$/, '')).join(', ') || '(ninguna: REA se está usando por npx)'}`
        return recortar(readFileSync(path.join(dirSkill, 'references', f), 'utf8'), cfg.maxCaracteres)
      }
      const skill = dirSkill && existsSync(path.join(dirSkill, 'SKILL.md')) ? readFileSync(path.join(dirSkill, 'SKILL.md'), 'utf8') : ''
      return recortar([
        nota,
        skill || '',
        !skill && c.instrucciones ? `## Instrucciones del servidor REA\n${c.instrucciones}` : '',
        refs.length ? `Referencias disponibles con rea_guia(tema): ${refs.map((x) => x.replace(/\.md$/, '')).join(', ')}` : '',
      ].filter(Boolean).join('\n\n'), cfg.maxCaracteres)
    },
  }

  ctx.tools.register(reaBuscar)
  ctx.tools.register(reaLlamar)
  ctx.tools.register(reaGuia)
}

export const _internals = { terminos, puntaje, ClienteMcp, candidatosScript }
