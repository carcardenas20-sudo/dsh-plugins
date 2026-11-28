// Motor de automatizaciones (proceso principal). Lee escritorio/automatizaciones/*.js, programa sus disparadores
// y ejecuta cada corrida en un proceso aparte (ejecutor.cjs) con tiempo máximo, reintentos e historial.
// Disparadores ("cuando"): { cron } · { cada } · { carpeta, archivos } · { tabla, evento, filtro } · { alIniciar } · { manual }
// o una lista de ellos.
// Funciona dentro de Electron (utilityProcess) y también como programa de Node aparte (servidor.cjs), que es como lo
// usan las apps hechas con Tauri (Rust) y JavaFX (Java).
'use strict'
// (en Node puro, require('electron') no existe o devuelve solo la ruta del programa: entonces no es Electron)
const electron = (() => { try { const e = require('electron'); return e && typeof e === 'object' && e.utilityProcess ? e : null } catch { return null } })()
const enElectron = !!electron
const { utilityProcess, powerMonitor } = electron || {}
const { fork } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { parsearCron, siguienteCron, duracion } = require('./cron.cjs')

// Cada corrida va en un proceso aparte: si una automatización se cuelga o revienta, la app sigue viva.
function lanzar(archivo, nombre, conSalida) {
  if (enElectron) return utilityProcess.fork(archivo, [], { serviceName: nombre, stdio: conSalida ? 'pipe' : 'ignore' })
  const p = fork(archivo, [], { stdio: conSalida ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true })
  p.postMessage = (m) => p.send(m)
  return p
}

const MAX_SIMULTANEAS = 3
const MAX_HISTORIAL = 800

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const hora12 = (h, m) => `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`
/** "0 18 * * 1-5" → "Lunes a viernes, 6:00 p. m." (si no lo sabe decir, muestra el cron tal cual). */
function cronEnPalabras(expr) {
  const t = String(expr).trim().split(/\s+/)
  if (t.length !== 5) return `Horario ${expr}`
  const [mi, ho, di, me, ds] = t
  let cuando
  if (/^\d+$/.test(mi) && /^\d+$/.test(ho)) cuando = hora12(Number(ho), Number(mi))
  else if (/^\d+$/.test(mi) && ho === '*') cuando = `cada hora (al minuto ${mi})`
  else if (/^\*\/\d+$/.test(mi) && ho === '*') cuando = `cada ${mi.slice(2)} min`
  else if (/^\*\/\d+$/.test(mi) && /^\d+-\d+$/.test(ho)) { const [a, b] = ho.split('-').map(Number); cuando = `cada ${mi.slice(2)} min de ${hora12(a, 0)} a ${hora12(b, 59)}` }
  else return `Horario ${expr}`
  let dias = ''
  if (me !== '*') return `Horario ${expr}`
  if (di !== '*' && ds === '*') dias = /^\d+$/.test(di) ? `El día ${di} de cada mes` : ''
  else if (ds !== '*' && di === '*') {
    if (ds === '1-5') dias = 'Lunes a viernes'
    else if (ds === '1-6') dias = 'Lunes a sábado'
    else if (/^[0-7]$/.test(ds)) dias = `Cada ${DIAS[Number(ds) % 7]}`
    else if (/^[0-7](,[0-7])+$/.test(ds)) dias = ds.split(',').map((x) => DIAS[Number(x) % 7]).join(', ').replace(/^./, (c) => c.toUpperCase())
    else return `Horario ${expr}`
  } else if (di === '*' && ds === '*') dias = 'Todos los días'
  else return `Horario ${expr}`
  if (!dias) return `Horario ${expr}`
  return `${dias}, ${cuando}`
}

function crearMotor({ carpetaAutomatizaciones, carpetaDatos, config, avisar, notificar, alEventoInterfaz, registrar = () => {}, armarDisparadores = true, pedirSecreto = () => null, alError = () => {} }) {
  const autos = new Map() // id → { meta, disparadores, activa, ejecutando, cola, ultima, proxima, temporizadores, vigilantes }
  const archivoMotor = path.join(carpetaDatos, 'motor.json')
  const archivoHistorial = path.join(carpetaDatos, 'historial.jsonl')
  let preferencias = {}
  try { preferencias = JSON.parse(fs.readFileSync(archivoMotor, 'utf8')) } catch {}
  preferencias.pausadas ||= []; preferencias.ultimaProgramada ||= {}
  const guardarPreferencias = () => { try { fs.mkdirSync(carpetaDatos, { recursive: true }); fs.writeFileSync(archivoMotor, JSON.stringify(preferencias, null, 2)) } catch {} }
  let enCurso = 0
  const esperando = []
  let sesion = null
  let infoUsuario = null // perfil del usuario con sesión: rol, sede…, automatizaciones permitidas
  let realtime = null
  let clienteBase = null
  const multiEquipo = !!(config.supabase?.url && config.supabase?.clave)
  const equipo = String(config.equipo || os.hostname())
  const base = () => {
    if (!multiEquipo || !sesion?.access_token) return null
    if (!clienteBase) {
      const { createClient } = require('@supabase/supabase-js')
      clienteBase = createClient(config.supabase.url, config.supabase.clave, { accessToken: async () => sesion?.access_token ?? null })
    }
    return clienteBase
  }
  // ---------- permisos por rol y equipo ----------
  function permitida(a) {
    if (!multiEquipo || !armarDisparadores) return { ok: true } // un solo equipo, o modo prueba
    if (!infoUsuario) return { ok: false, motivo: 'Esperando que alguien inicie sesión en la app' }
    if (infoUsuario.rol === 'admin' || (infoUsuario.automatizaciones || []).some((x) => x === '*' || x === a.id)) return { ok: true }
    return { ok: false, motivo: `El rol "${infoUsuario.rol}" no tiene permiso para esta automatización` }
  }
  // correEn: { rol: 'admin' } · { sede: ['Norte'] } · { equipo: 'CAJA-1' }: los horarios y vigilantes solo se activan en esos equipos
  function correAqui(a) {
    const c = a.meta.correEn
    if (!c || typeof c !== 'object') return { ok: true }
    for (const [k, v] of Object.entries(c)) {
      const valores = (Array.isArray(v) ? v : [v]).map((x) => String(x).toLowerCase())
      const actual = k === 'equipo' ? equipo : infoUsuario?.[k]
      if (actual === undefined || actual === null || !valores.includes(String(actual).toLowerCase())) return { ok: false, motivo: `Corre solo donde ${k} sea ${valores.join(' o ')} (aquí: ${actual ?? 'sin dato'})` }
    }
    return { ok: true }
  }
  // Con varios equipos, una tarea programada o un cambio de tabla corre en uno solo: el primero que toma el turno.
  async function tomarTurno(a, disparo) {
    if (!multiEquipo || a.meta.unaVez === false || !['cron', 'cada', 'tabla'].includes(disparo.tipo)) return true
    const db = base()
    if (!db) return true
    const ms = (() => { try { return duracion(a.disparadores.find((d) => d.cada)?.cada) } catch { return 0 } })()
    const marca = disparo.tipo === 'cron' ? disparo.programada : disparo.tipo === 'cada' ? new Date(Math.floor(Date.now() / (ms || 60e3)) * (ms || 60e3)).toISOString() : `${disparo.tabla}:${disparo.evento}:${disparo.fila?.id ?? disparo.anterior?.id ?? ''}:${disparo.confirmado ?? ''}`
    const { error } = await db.from('automatizacion_turnos').insert({ clave: `${a.id}@${marca}`, equipo })
    if (!error) return true
    if (error.code === '23505' || /duplicate key/i.test(error.message)) { registrar(`[${a.id}] otro equipo tomó el turno (${marca})`); return false }
    registrar(`[${a.id}] no se pudo tomar turno (${error.message}); corre aquí por si acaso`)
    return true
  }
  async function anotarEnBase(entrada) {
    const db = base()
    if (!db) return
    let resultado = entrada.resultado
    try { if (JSON.stringify(resultado).length > 4000) resultado = { resumen: JSON.stringify(resultado).slice(0, 4000) } } catch { resultado = null }
    const { error } = await db.from('automatizacion_corridas').insert({ automatizacion: entrada.id, nombre: entrada.nombre, equipo, inicio: entrada.inicio, fin: entrada.fin, ok: entrada.ok, disparo: entrada.disparo?.tipo, error: entrada.error, resultado: typeof resultado === 'string' ? { texto: resultado } : resultado })
    if (error) registrar(`[${entrada.id}] no se pudo anotar la corrida en la base: ${error.message}`)
  }
  let detenido = false

  const rutaDe = (p) => { p = String(p); if (p === '~' || /^~[\\/]/.test(p)) p = path.join(os.homedir(), p.slice(1)); return path.resolve(p) }
  const patron = (g) => new RegExp('^' + String(g || '*').split('|').map((x) => x.trim().replace(/[.+^${}()[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')).join('|') + '$', 'i')

  // ---------- historial ----------
  function anotar(entrada) {
    try {
      fs.mkdirSync(carpetaDatos, { recursive: true })
      fs.appendFileSync(archivoHistorial, JSON.stringify(entrada) + '\n')
      if (Math.random() < 0.05) {
        const lineas = fs.readFileSync(archivoHistorial, 'utf8').trim().split('\n')
        if (lineas.length > MAX_HISTORIAL) fs.writeFileSync(archivoHistorial, lineas.slice(-MAX_HISTORIAL).join('\n') + '\n')
      }
    } catch {}
  }
  function historial(id, n = 50) {
    try {
      const l = fs.readFileSync(archivoHistorial, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x))
      return (id ? l.filter((e) => e.id === id) : l).slice(-n).reverse()
    } catch { return [] }
  }

  // ---------- estado visible ----------
  function textoCuando(d) {
    if (d.cron) return cronEnPalabras(d.cron)
    if (d.cada) return `Cada ${d.cada}`
    if (d.carpeta) return `Al llegar ${d.archivos || 'archivos'} a ${d.carpeta}`
    if (d.tabla) return `Cuando cambie "${d.tabla}"${d.evento && d.evento !== '*' ? ` (${d.evento})` : ''}`
    if (d.alIniciar) return 'Al abrir la app'
    return 'A mano'
  }
  function resumen(a) {
    const perm = permitida(a), aqui = correAqui(a)
    return {
      permitida: perm.ok, correAqui: aqui.ok, bloqueo: !perm.ok ? perm.motivo : !aqui.ok ? aqui.motivo : null,
      id: a.id, nombre: a.meta.nombre || a.id, descripcion: a.meta.descripcion || '', error: a.error || null,
      cuando: a.disparadores.map(textoCuando), activa: a.activa, ejecutando: !!a.proceso, enCola: a.cola.length,
      progreso: a.progreso || null, enPrueba: a.meta.enPrueba, secretos: a.meta.secretos || [], proxima: a.proxima ? a.proxima.toISOString() : null, ultima: a.ultima || null,
      tiposDisparo: a.disparadores.map((d) => d.cron ? 'cron' : d.cada ? 'cada' : d.carpeta ? 'carpeta' : d.tabla ? 'tabla' : d.alIniciar ? 'alIniciar' : 'manual'),
    }
  }
  const lista = () => [...autos.values()].map(resumen).filter((r) => r.permitida || !infoUsuario) // sin permiso no se muestran
  let pendienteAviso = null
  const cambio = () => { if (pendienteAviso) return; pendienteAviso = setTimeout(() => { pendienteAviso = null; avisar(lista()) }, 120) }

  // ---------- ejecución ----------
  function encolar(id, disparo) {
    const a = autos.get(id)
    if (!a || a.error) return false
    if (!permitida(a).ok) { registrar(`[${id}] no corre: ${permitida(a).motivo}`); return false }
    if (['cron', 'cada', 'tabla'].includes(disparo.tipo) && multiEquipo && a.meta.unaVez !== false && !disparo.turno) {
      tomarTurno(a, disparo).then((ok) => { if (ok) encolar(id, { ...disparo, turno: true }) })
      return true
    }
    if (a.cola.length >= 100) { registrar(`[${id}] cola llena, se descarta un disparo`); return false }
    a.cola.push({ disparo: { hora: new Date().toISOString(), ...disparo }, intento: 0 })
    bombear(); cambio()
    return true
  }
  function bombear() {
    for (const a of autos.values()) {
      if (!a.proceso && a.cola.length && enCurso < MAX_SIMULTANEAS && !detenido) correr(a, a.cola.shift())
    }
  }
  function correr(a, trabajo) {
    enCurso++
    const inicio = new Date()
    const registros = []
    const anotarRegistro = (t) => { registros.push(`${new Date().toTimeString().slice(0, 8)} ${t}`); if (registros.length > 300) registros.splice(0, registros.length - 300) }
    const ejecutor = path.join(__dirname, 'ejecutor.cjs')
    const p = lanzar(ejecutor, `Automatización ${a.meta.nombre || a.id}`, true)
    a.proceso = p; a.progreso = null
    let terminado = false
    p.stdout?.on('data', (b) => String(b).split('\n').filter(Boolean).forEach((x) => anotarRegistro(x)))
    p.stderr?.on('data', (b) => String(b).split('\n').filter(Boolean).forEach((x) => anotarRegistro(`⚠ ${x}`)))
    const limite = duracion(a.meta.tiempoMaximo, 10 * 60e3)
    const reloj = setTimeout(() => terminar({ ok: false, error: `Superó el tiempo máximo (${a.meta.tiempoMaximo || '10m'}) y se detuvo.` }, true), limite)
    function terminar(r, matar = false) {
      if (terminado) return
      terminado = true
      clearTimeout(reloj)
      if (matar) { try { p.postMessage({ tipo: 'cancelar' }) } catch {} ; setTimeout(() => { try { p.kill() } catch {} }, 1500) }
      enCurso--
      a.proceso = null; a.progreso = null
      const entrada = { id: a.id, nombre: a.meta.nombre || a.id, inicio: inicio.toISOString(), fin: new Date().toISOString(), ms: Date.now() - inicio.getTime(), ok: !!r.ok, disparo: trabajo.disparo, intento: trabajo.intento + 1, resultado: r.resultado ?? null, error: r.error || null, pila: r.pila || null, capturas: r.capturas || [], registros }
      anotar(entrada)
      anotarEnBase(entrada).catch(() => {})
      a.ultima = { ok: entrada.ok, fin: entrada.fin, ms: entrada.ms, error: entrada.error, resultado: entrada.resultado }
      registrar(`[${a.id}] ${entrada.ok ? 'ok' : 'falló'} en ${entrada.ms} ms${entrada.error ? `: ${entrada.error}` : ''}`)
      if (!entrada.ok) {
        const reintentos = a.meta.reintentos ?? 0
        if (trabajo.intento < reintentos && !detenido) {
          const espera = Math.min(30e3 * 2 ** trabajo.intento, 15 * 60e3)
          anotarRegistro(`reintento ${trabajo.intento + 1} de ${reintentos} en ${Math.round(espera / 1000)} s`)
          setTimeout(() => { a.cola.unshift({ ...trabajo, intento: trabajo.intento + 1 }); bombear(); cambio() }, espera)
        } else {
          if (a.meta.avisarError !== false) notificar(`${a.meta.nombre || a.id} falló`, entrada.error || 'Error desconocido', a.id)
          try { alError(a.id, entrada.error || 'Error desconocido') } catch {}
        }
      } else if (a.meta.avisarExito) {
        notificar(a.meta.nombre || a.id, typeof r.resultado === 'string' ? r.resultado : 'Terminó bien', a.id)
      }
      cambio()
      setImmediate(bombear)
    }
    p.on('message', (m) => {
      if (!m || typeof m !== 'object') return
      if (m.tipo === 'registro') anotarRegistro(m.texto)
      else if (m.tipo === 'notificar') notificar(m.titulo, m.cuerpo, a.id)
      else if (m.tipo === 'interfaz') alEventoInterfaz({ id: a.id, evento: m.evento, datos: m.datos })
      else if (m.tipo === 'encadenar') { if (autos.has(m.id)) encolar(m.id, { tipo: 'encadenada', desde: a.id, datos: m.datos }); else anotarRegistro(`⚠ no existe la automatización "${m.id}"`) }
      else if (m.tipo === 'progreso') { a.progreso = { porcentaje: m.porcentaje, texto: m.texto || '' }; cambio() }
      else if (m.tipo === 'secreto') Promise.resolve().then(() => pedirSecreto(a.id, String(m.nombre))).catch(() => null).then((valor) => { try { p.postMessage({ tipo: 'secreto-respuesta', pedido: m.pedido, valor: valor ?? null }) } catch {} })
      else if (m.tipo === 'fin') terminar(m)
    })
    p.on('exit', (codigo) => terminar({ ok: false, error: `El proceso de la automatización se cerró inesperadamente (código ${codigo}).` }))
    p.once('spawn', () => p.postMessage({ tipo: 'ejecutar', datos: { id: a.id, archivo: a.meta.archivo, disparo: trabajo.disparo, config: { supabase: config.supabase, robot: config.robot, variables: config.variables }, carpetaDatos, sesion } }))
    cambio()
  }

  // ---------- disparadores ----------
  function programarCron(a, d) {
    let c
    try { c = parsearCron(d.cron) } catch (e) { a.error = e.message; return }
    const armar = () => {
      if (detenido || !a.activa) return
      const proxima = siguienteCron(c, new Date())
      a.proxima = !a.proxima || proxima < a.proxima ? proxima : a.proxima
      const espera = Math.min(proxima.getTime() - Date.now(), 3600e3) // de a máximo 1 h: así un PC dormido no descuadra la hora
      const t = setTimeout(() => {
        a.temporizadores.delete(t)
        if (Date.now() >= proxima.getTime() - 500) {
          preferencias.ultimaProgramada[a.id] = proxima.toISOString(); guardarPreferencias()
          a.proxima = null
          encolar(a.id, { tipo: 'cron', programada: proxima.toISOString() })
        }
        armar()
      }, Math.max(espera, 0))
      a.temporizadores.add(t)
      cambio()
    }
    // Ponerse al día: si el PC estuvo apagado a la hora programada, corre una vez al abrir.
    if (a.meta.ponerseAlDia) {
      const ultima = preferencias.ultimaProgramada[a.id]
      if (ultima) {
        try { const debio = siguienteCron(c, new Date(ultima)); if (debio < new Date()) setTimeout(() => encolar(a.id, { tipo: 'cron', programada: debio.toISOString(), atrasada: true }), 8000) } catch {}
      }
      preferencias.ultimaProgramada[a.id] ||= new Date().toISOString(); guardarPreferencias()
    }
    armar()
  }
  function programarCada(a, d) {
    let ms
    try { ms = duracion(d.cada); if (ms < 10e3) throw new Error('"cada" debe ser de 10 segundos o más') } catch (e) { a.error = e.message; return }
    const armar = () => {
      if (detenido || !a.activa) return
      a.proxima = new Date(Date.now() + ms)
      const t = setTimeout(() => { a.temporizadores.delete(t); encolar(a.id, { tipo: 'cada' }); armar() }, ms)
      a.temporizadores.add(t)
    }
    if (d.ya) setTimeout(() => encolar(a.id, { tipo: 'cada' }), 5000) // { cada: '1h', ya: true } corre también al abrir
    armar()
  }
  function vigilarCarpeta(a, d) {
    const dir = rutaDe(d.carpeta)
    const re = patron(d.archivos)
    try { fs.mkdirSync(dir, { recursive: true }) } catch {}
    const vistos = new Map() // archivo → firma (tamaño+fecha) ya procesada
    try { for (const n of fs.readdirSync(dir)) { const s = fs.statSync(path.join(dir, n)); vistos.set(n, `${s.size}:${s.mtimeMs}`) } } catch {}
    const pendientes = new Map()
    const revisar = (nombre) => {
      if (!nombre || !re.test(nombre) || /^~\$|\.(crdownload|part|tmp)$/i.test(nombre)) return
      clearTimeout(pendientes.get(nombre))
      // Espera a que el archivo termine de copiarse (mismo tamaño dos veces seguidas).
      const esperar = (antes) => pendientes.set(nombre, setTimeout(() => {
        const f = path.join(dir, nombre)
        let s; try { s = fs.statSync(f) } catch { pendientes.delete(nombre); return }
        if (!s.isFile()) return
        const firma = `${s.size}:${s.mtimeMs}`
        if (firma !== antes) return esperar(firma)
        pendientes.delete(nombre)
        if (vistos.get(nombre) === firma) return
        vistos.set(nombre, firma)
        encolar(a.id, { tipo: 'carpeta', archivo: f, nombre })
      }, 1200))
      esperar(null)
    }
    try {
      const w = fs.watch(dir, (_ev, nombre) => { if (a.activa) revisar(nombre && String(nombre)) })
      w.on('error', (e) => { a.error = `No se pudo vigilar ${dir}: ${e.message}`; cambio() })
      a.vigilantes.add(w)
    } catch (e) { a.error = `No se pudo vigilar ${dir}: ${e.message}` }
    // Respaldo cada 20 s por si el sistema no avisa (carpetas de red, OneDrive, Google Drive…).
    const t = setInterval(() => { if (!a.activa) return; try { for (const n of fs.readdirSync(dir)) { const s = fs.statSync(path.join(dir, n)); if (s.isFile() && vistos.get(n) !== `${s.size}:${s.mtimeMs}` && !pendientes.has(n)) revisar(n) } } catch {} }, 20e3)
    a.temporizadores.add(t)
  }
  function escucharTabla(a, d) {
    if (!config.supabase?.url || !config.supabase?.clave) { a.error = 'Para "tabla" falta "supabase": { "url", "clave" } en escritorio.config.json'; return }
    try {
      if (!realtime) {
        const { createClient } = require('@supabase/supabase-js')
        realtime = createClient(config.supabase.url, config.supabase.clave, { auth: { persistSession: false }, realtime: { transport: require('ws') } })
        if (sesion?.access_token) realtime.realtime.setAuth(sesion.access_token)
      }
      const filtro = { event: (d.evento || '*').toUpperCase(), schema: d.esquema || 'public', table: d.tabla, ...(d.filtro ? { filter: d.filtro } : {}) }
      const canal = realtime.channel(`auto-${a.id}-${d.tabla}`)
        .on('postgres_changes', filtro, (c) => { if (a.activa) encolar(a.id, { tipo: 'tabla', tabla: d.tabla, evento: c.eventType, fila: c.new, anterior: c.old, confirmado: c.commit_timestamp }) })
        .subscribe((estado, err) => { a.conexion = estado; if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') registrar(`[${a.id}] tiempo real: ${estado} ${err?.message || ''}`); cambio() })
      a.canales.add(canal)
    } catch (e) { a.error = `Tiempo real: ${e.message}` }
  }

  function armar(a) {
    desarmar(a)
    if (!a.activa || a.error || !permitida(a).ok || !correAqui(a).ok) return
    for (const d of a.disparadores) {
      if (d.cron) programarCron(a, d)
      else if (d.cada) programarCada(a, d)
      else if (d.carpeta) vigilarCarpeta(a, d)
      else if (d.tabla) escucharTabla(a, d)
      else if (d.alIniciar && !a.arrancada) { a.arrancada = true; setTimeout(() => encolar(a.id, { tipo: 'alIniciar' }), 5000) }
    }
  }
  function desarmar(a) {
    for (const t of a.temporizadores) { clearTimeout(t); clearInterval(t) }
    a.temporizadores.clear()
    for (const w of a.vigilantes) { try { w.close() } catch {} }
    a.vigilantes.clear()
    for (const c of a.canales) { try { realtime?.removeChannel(c) } catch {} }
    a.canales.clear()
    a.proxima = null
  }

  // ---------- carga ----------
  function describir(archivos) {
    return new Promise((resolver) => {
      if (!archivos.length) return resolver([])
      const p = lanzar(path.join(__dirname, 'ejecutor.cjs'), 'Automatizaciones (lectura)', false)
      const t = setTimeout(() => { try { p.kill() } catch {} ; resolver(archivos.map((archivo) => ({ archivo, error: 'no se pudo leer (tardó demasiado)' }))) }, 30e3)
      p.on('message', (m) => { if (m?.tipo === 'descripcion') { clearTimeout(t); resolver(m.lista) } })
      p.once('spawn', () => p.postMessage({ tipo: 'describir', archivos }))
    })
  }
  async function cargar() {
    let archivos = []
    try { archivos = fs.readdirSync(carpetaAutomatizaciones).filter((n) => /\.(c?js|mjs)$/.test(n) && !n.startsWith('_')).sort().map((n) => path.join(carpetaAutomatizaciones, n)) } catch {}
    const metas = await describir(archivos)
    for (const meta of metas) {
      const id = path.basename(meta.archivo).replace(/\.(c?js|mjs)$/, '')
      const cuando = meta.cuando ? (Array.isArray(meta.cuando) ? meta.cuando : [meta.cuando]) : [{ manual: true }]
      const a = { id, meta, disparadores: cuando, error: meta.error || null, cola: [], temporizadores: new Set(), vigilantes: new Set(), canales: new Set(), ultima: null, proxima: null }
      a.activa = !preferencias.pausadas.includes(id) && meta.activa !== false
      const ult = historial(id, 1)[0]
      if (ult) a.ultima = { ok: ult.ok, fin: ult.fin, ms: ult.ms, error: ult.error, resultado: ult.resultado }
      autos.set(id, a)
    }
    if (armarDisparadores) for (const a of autos.values()) armar(a)
    registrar(`motor: ${autos.size} automatizaciones (${[...autos.values()].filter((a) => a.error).length} con error)`)
    const alDespertar = () => { for (const a of autos.values()) if (a.disparadores.some((d) => d.cron || d.cada)) armar(a) }
    if (powerMonitor) powerMonitor.on('resume', alDespertar)
    else { // fuera de Electron: si el reloj saltó más de 2 min, el PC estuvo dormido
      let ultimo = Date.now()
      setInterval(() => { const ahora = Date.now(); if (ahora - ultimo > 120e3) alDespertar(); ultimo = ahora }, 30e3).unref()
    }
    cambio()
    return lista()
  }

  return {
    cargar, lista, historial,
    ejecutar: (id, datos) => {
      const a = autos.get(id)
      if (!a) throw new Error(`No existe la automatización "${id}"`)
      const p = permitida(a); if (!p.ok) throw new Error(p.motivo)
      return encolar(id, { tipo: 'manual', datos: datos ?? null })
    },
    activar(id, activa) {
      const a = autos.get(id); if (!a) throw new Error(`No existe "${id}"`)
      a.activa = !!activa
      preferencias.pausadas = preferencias.pausadas.filter((x) => x !== id).concat(activa ? [] : [id]); guardarPreferencias()
      armar(a); cambio()
    },
    cancelar(id) { const a = autos.get(id); if (a?.proceso) { a.cola = []; try { a.proceso.postMessage({ tipo: 'cancelar' }) } catch {} ; setTimeout(() => { try { a.proceso?.kill() } catch {} }, 1500) } },
    fijarSesion(s, info) {
      const antes = JSON.stringify([infoUsuario?.id, infoUsuario?.rol, infoUsuario?.automatizaciones, infoUsuario && Object.entries(infoUsuario).filter(([k]) => !['automatizaciones'].includes(k))])
      sesion = s && s.access_token ? { access_token: s.access_token, refresh_token: s.refresh_token } : null
      infoUsuario = sesion && info && typeof info === 'object' ? { ...info } : null
      try { realtime?.realtime.setAuth(sesion?.access_token || config.supabase?.clave) } catch {}
      const despues = JSON.stringify([infoUsuario?.id, infoUsuario?.rol, infoUsuario?.automatizaciones, infoUsuario && Object.entries(infoUsuario).filter(([k]) => !['automatizaciones'].includes(k))])
      // cambió quién está o su rol: se rearman horarios y vigilantes según los permisos nuevos
      if (antes !== despues && armarDisparadores) { for (const a of autos.values()) armar(a); registrar(`sesión: ${infoUsuario ? `${infoUsuario.correo || infoUsuario.id} (${infoUsuario.rol})` : 'sin sesión'}`) }
      cambio()
    },
    equipo,
    esperarTodas: () => new Promise((r) => { const v = () => ([...autos.values()].some((a) => a.proceso || a.cola.length) ? setTimeout(v, 300) : r()); v() }),
    detener() { detenido = true; for (const a of autos.values()) { desarmar(a); try { a.proceso?.kill() } catch {} } },
  }
}

module.exports = { crearMotor, cronEnPalabras }
