// Ejecuta UNA automatización en un proceso aparte (utilityProcess de Electron).
// Si la automatización se cuelga o revienta, la app sigue viva: el motor mata este proceso y lo anota en el historial.
'use strict'
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { pathToFileURL } = require('node:url')

const enviar = (m) => process.parentPort.postMessage(m)
let cancelado = false
const robots = []
const fotos = [] // capturas tomadas con pagina.captura() durante la corrida

function rutaDe(p) {
  if (!p) throw new Error('falta la ruta')
  p = String(p)
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1))
  return path.resolve(p)
}

function comoTexto(v) {
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return String(v) }
}

function patronARegex(patron) {
  const esc = String(patron).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${esc}$`, 'i')
}

function csv(filas, columnas) {
  if (!filas.length) return '﻿'
  const cols = columnas || Object.keys(filas[0])
  const celda = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return '﻿' + [cols.map(celda).join(','), ...filas.map((f) => cols.map((c) => celda(f[c])).join(','))].join('\r\n') + '\r\n'
}

function leerCsv(texto) {
  texto = String(texto).replace(/^﻿/, '')
  const sep = (texto.split('\n')[0].match(/;/g) || []).length > (texto.split('\n')[0].match(/,/g) || []).length ? ';' : ','
  const filas = []; let fila = []; let celda = ''; let comillas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (comillas) { if (c === '"' && texto[i + 1] === '"') { celda += '"'; i++ } else if (c === '"') comillas = false; else celda += c }
    else if (c === '"') comillas = true
    else if (c === sep) { fila.push(celda); celda = '' }
    else if (c === '\n') { fila.push(celda.replace(/\r$/, '')); filas.push(fila); fila = []; celda = '' }
    else celda += c
  }
  if (celda || fila.length) { fila.push(celda.replace(/\r$/, '')); filas.push(fila) }
  const [enc, ...resto] = filas.filter((f) => f.some((x) => x !== ''))
  return enc ? resto.map((f) => Object.fromEntries(enc.map((k, i) => [k.trim(), f[i] ?? '']))) : []
}

function crearContexto(d) {
  const carpetaDatos = d.carpetaDatos
  const archivoEstado = path.join(carpetaDatos, 'estado', `${d.id}.json`)
  let estadoMem = null
  const cargarEstado = () => { if (!estadoMem) { try { estadoMem = JSON.parse(fs.readFileSync(archivoEstado, 'utf8')) } catch { estadoMem = {} } } return estadoMem }

  const archivos = {
    ruta: rutaDe,
    existe: (p) => fs.existsSync(rutaDe(p)),
    leer: (p, como = 'texto') => { const b = fs.readFileSync(rutaDe(p)); return como === 'json' ? JSON.parse(b.toString('utf8').replace(/^﻿/, '')) : como === 'bytes' ? b : b.toString('utf8') },
    escribir: (p, contenido) => { const f = rutaDe(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof contenido === 'string' || Buffer.isBuffer(contenido) ? contenido : JSON.stringify(contenido, null, 2)); return f },
    agregar: (p, texto) => { const f = rutaDe(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, texto); return f },
    listar: (dir, patron = '*') => { const r = rutaDe(dir); const re = patronARegex(patron); return fs.existsSync(r) ? fs.readdirSync(r).filter((n) => re.test(n)).map((n) => path.join(r, n)) : [] },
    mover: (de, a) => { const f = rutaDe(a); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.renameSync(rutaDe(de), f); return f },
    copiar: (de, a) => { const f = rutaDe(a); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(rutaDe(de), f); return f },
    crearCarpeta: (p) => { const f = rutaDe(p); fs.mkdirSync(f, { recursive: true }); return f },
    csv, leerCsv,
    carpetaApp: path.join(carpetaDatos, 'archivos'),
  }

  const estado = {
    leer: (k, porDefecto) => (k in cargarEstado() ? cargarEstado()[k] : porDefecto),
    guardar: (k, v) => { cargarEstado()[k] = v; fs.mkdirSync(path.dirname(archivoEstado), { recursive: true }); fs.writeFileSync(archivoEstado, JSON.stringify(estadoMem, null, 2)); return v },
    todo: () => ({ ...cargarEstado() }),
  }

  let cliente = null
  const db = () => {
    if (cliente) return cliente
    const s = d.config.supabase
    if (!s?.url || !s?.clave) throw new Error('No hay base de datos configurada: falta "supabase": { "url", "clave" } en escritorio.config.json')
    const { createClient } = require('@supabase/supabase-js')
    cliente = createClient(s.url, s.clave, { auth: { persistSession: false, autoRefreshToken: false } })
    if (d.sesion?.access_token) cliente.auth.setSession(d.sesion).catch(() => {})
    return cliente
  }

  async function robot(op = {}) {
    const { chromium } = require('playwright-core')
    const conf = { ...(d.config.robot || {}), ...op }
    const visible = conf.visible ?? false
    const descargas = path.join(carpetaDatos, 'descargas')
    fs.mkdirSync(descargas, { recursive: true })
    const comun = { headless: !visible, acceptDownloads: true, downloadsPath: descargas, viewport: conf.pantalla || { width: 1366, height: 860 }, locale: conf.idioma || 'es-CO', timeout: 60_000, slowMo: conf.lento ? 250 : 0 }
    // Usa el navegador que ya tiene el PC: Edge viene en todo Windows; Chrome en la mayoría de Mac y Linux.
    const candidatos = conf.navegador ? [{ executablePath: rutaDe(conf.navegador) }]
      : process.platform === 'win32' ? [{ channel: 'msedge' }, { channel: 'chrome' }]
      : [{ channel: 'chrome' }, { channel: 'msedge' }, ...['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(fs.existsSync).map((e) => ({ executablePath: e }))]
    let ultimoError
    for (const cand of candidatos) {
      try {
        let contexto, navegador
        if (conf.sesion) {
          // Sesión con nombre: guarda cookies e inicio de sesión entre ejecuciones (ej. robot({ sesion: 'banco' })).
          const dir = path.join(carpetaDatos, 'robots', String(conf.sesion).replace(/[^\w.-]+/g, '_'))
          contexto = await chromium.launchPersistentContext(dir, { ...comun, ...cand })
        } else {
          navegador = await chromium.launch({ headless: comun.headless, slowMo: comun.slowMo, downloadsPath: descargas, ...cand })
          contexto = await navegador.newContext({ acceptDownloads: true, viewport: comun.viewport, locale: comun.locale })
        }
        contexto.setDefaultTimeout(conf.espera ?? 30_000)
        const pagina = contexto.pages()[0] || await contexto.newPage()
        pagina.captura = async (nombre = 'captura') => {
          const f = path.join(carpetaDatos, 'capturas', `${d.id}-${Date.now()}-${String(nombre).replace(/[^\w.-]+/g, '_')}.png`)
          fs.mkdirSync(path.dirname(f), { recursive: true }); await pagina.screenshot({ path: f, fullPage: true }); fotos.push({ archivo: f, url: pagina.url() }); return f
        }
        pagina.descargar = async (accion, destino) => {
          const [descarga] = await Promise.all([pagina.waitForEvent('download'), accion()])
          const f = destino ? rutaDe(destino) : path.join(descargas, descarga.suggestedFilename())
          fs.mkdirSync(path.dirname(f), { recursive: true }); await descarga.saveAs(f); return f
        }
        pagina.contexto = contexto
        robots.push({ contexto, navegador })
        enviar({ tipo: 'registro', texto: `robot abierto (${cand.channel || path.basename(cand.executablePath)}${conf.sesion ? `, sesión "${conf.sesion}"` : ''}${visible ? ', visible' : ''})` })
        return pagina
      } catch (e) { ultimoError = e }
    }
    throw new Error(`No se pudo abrir un navegador para el robot (Edge o Chrome). Instala uno o pon "robot": { "navegador": "ruta" } en la configuración. Detalle: ${String(ultimoError?.message || ultimoError).split('\n')[0]}`)
  }

  return {
    disparo: d.disparo,
    config: d.config.variables || {},
    registro: (...t) => enviar({ tipo: 'registro', texto: t.map(comoTexto).join(' ').slice(0, 2000) }),
    notificar: (titulo, cuerpo = '') => enviar({ tipo: 'notificar', titulo: String(titulo), cuerpo: String(cuerpo) }),
    interfaz: (evento, datos) => enviar({ tipo: 'interfaz', evento: String(evento), datos }),
    ejecutar: (id, datos) => enviar({ tipo: 'encadenar', id: String(id), datos }),
    progreso: (porcentaje, texto) => enviar({ tipo: 'progreso', porcentaje: Math.max(0, Math.min(100, Number(porcentaje) || 0)), texto }),
    pausa: (ms) => new Promise((r) => setTimeout(r, typeof ms === 'string' ? require('./cron.cjs').duracion(ms) : ms)),
    cancelado: () => cancelado,
    archivos, estado, robot,
    // Se conecta solo al usarla: así una automatización sin base de datos no necesita configurarla.
    db: new Proxy({}, { get: (_t, k) => { const c = db(); const v = c[k]; return typeof v === 'function' ? v.bind(c) : v } }),
    http: fetch,
  }
}

async function cerrarRobots() {
  for (const r of robots.splice(0)) { try { await r.contexto.close() } catch {} ; try { await r.navegador?.close() } catch {} }
}

async function capturasDeError(d) {
  const fotos = []
  for (const r of robots) {
    for (const p of r.contexto.pages()) {
      try {
        const f = path.join(d.carpetaDatos, 'capturas', `${d.id}-${Date.now()}-error.png`)
        fs.mkdirSync(path.dirname(f), { recursive: true }); await p.screenshot({ path: f }); fotos.push({ archivo: f, url: p.url() })
      } catch {}
    }
  }
  return fotos
}

async function ejecutar(d) {
  const inicio = Date.now()
  try {
    let mod
    try { mod = require(d.archivo) } catch (e) {
      if (e.code === 'ERR_REQUIRE_ESM' || /Cannot use import statement|Unexpected token 'export'/.test(e.message)) mod = await import(pathToFileURL(d.archivo).href)
      else throw e
    }
    const auto = mod.default && !mod.ejecutar ? mod.default : mod
    if (typeof auto.ejecutar !== 'function') throw new Error('La automatización no exporta ejecutar(ctx)')
    const resultado = await auto.ejecutar(crearContexto(d))
    await cerrarRobots()
    let r = resultado === undefined ? null : resultado
    try { if (JSON.stringify(r).length > 20_000) r = { resumen: String(JSON.stringify(r)).slice(0, 2000) + '…' } } catch { r = String(r) }
    enviar({ tipo: 'fin', ok: true, resultado: r, capturas: fotos, ms: Date.now() - inicio })
  } catch (e) {
    const capturas = await capturasDeError(d)
    await cerrarRobots()
    const sinColores = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, '').replace(/\[\d+m/g, '')
    enviar({ tipo: 'fin', ok: false, error: sinColores(e?.message || e).split('\nCall log:')[0].trim().slice(0, 1500), pila: String(e?.stack || '').split('\n').slice(1, 6).join('\n'), capturas: [...fotos, ...capturas], ms: Date.now() - inicio })
  }
}

// Lee nombre, horario, etc. de cada archivo sin ejecutarlo (el proceso principal nunca carga código de automatizaciones).
async function describir(archivos) {
  const lista = []
  for (const archivo of archivos) {
    try {
      let mod
      try { mod = require(archivo) } catch (e) { if (e.code === 'ERR_REQUIRE_ESM' || /import statement|'export'/.test(e.message)) mod = await import(pathToFileURL(archivo).href); else throw e }
      const a = mod.default && !mod.ejecutar ? mod.default : mod
      if (typeof a.ejecutar !== 'function') throw new Error('no exporta ejecutar(ctx)')
      const limpio = (v) => JSON.parse(JSON.stringify(v ?? null))
      lista.push({ archivo, nombre: a.nombre, descripcion: a.descripcion, cuando: limpio(a.cuando), tiempoMaximo: a.tiempoMaximo, reintentos: a.reintentos, avisarError: a.avisarError, avisarExito: a.avisarExito, activa: a.activa, ponerseAlDia: a.ponerseAlDia, enPrueba: a.enPrueba, correEn: limpio(a.correEn), unaVez: a.unaVez })
    } catch (e) { lista.push({ archivo, error: String(e?.message || e).split('\n')[0] }) }
  }
  enviar({ tipo: 'descripcion', lista })
}

process.parentPort.on('message', (ev) => {
  const m = ev.data
  if (m?.tipo === 'describir') describir(m.archivos).finally(() => setTimeout(() => process.exit(0), 50))
  if (m?.tipo === 'ejecutar') ejecutar(m.datos).finally(() => setTimeout(() => process.exit(0), 50))
  if (m?.tipo === 'cancelar') { cancelado = true; cerrarRobots() }
})
