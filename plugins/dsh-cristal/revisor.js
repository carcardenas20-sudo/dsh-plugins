// Revisor de dsh-cristal: abre la interfaz (archivo o servidor de desarrollo) en el Edge o
// Chrome del computador, sin ventana, y la mide en escritorio claro, escritorio oscuro y
// celular. Revisa lo visual (desbordes, texto cortado o encimado, contraste, áreas de toque)
// y el movimiento (qué propiedades se animan, duración, saltos al cargar, si respeta
// "reducir movimiento"). Toma capturas en reposo para que el agente las mire.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const VISTAS = [
  { nombre: 'escritorio', ancho: 1280, alto: 860, movil: false, tema: 'light' },
  { nombre: 'oscuro', ancho: 1280, alto: 860, movil: false, tema: 'dark' },
  { nombre: 'celular', ancho: 390, alto: 844, movil: true, tema: 'light' },
]

export function candidatosNavegador(env = process.env, plataforma = process.platform) {
  if (plataforma === 'win32') {
    const bases = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean)
    const rel = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'Chromium\\Application\\chrome.exe']
    return bases.flatMap((b) => rel.map((r) => path.win32.join(b, r)))
  }
  if (plataforma === 'darwin') return ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser'].map((a) => `/Applications/${a}.app/Contents/MacOS/${a}`)
  const dirs = String(env.PATH ?? '/usr/bin:/usr/local/bin').split(':')
  const nombres = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser']
  return [...nombres.flatMap((n) => dirs.map((d) => path.join(d, n))), '/snap/bin/chromium']
}
export function buscarNavegador(preferido) {
  if (preferido) return existsSync(preferido) ? preferido : null
  return candidatosNavegador().find((p) => existsSync(p)) ?? null
}

/** Solo se revisan archivos del computador o servidores locales (localhost / 127.0.0.1). */
export function objetivoValido(o) {
  if (/^https?:\/\//i.test(o)) {
    let u
    try { u = new URL(o) } catch { return false }
    return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  }
  return true
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pendientes = new Map(); this.oyentes = new Map()
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'))
      if (m.id && this.pendientes.has(m.id)) {
        const { ok, mal } = this.pendientes.get(m.id); this.pendientes.delete(m.id)
        m.error ? mal(new Error(`${m.error.message}`)) : ok(m.result)
      } else if (m.method) for (const f of this.oyentes.get(m.method) ?? []) f(m.params)
    })
  }
  static abrir(url) {
    return new Promise((ok, mal) => {
      const ws = new WebSocket(url)
      ws.addEventListener('open', () => ok(new Cdp(ws)), { once: true })
      ws.addEventListener('error', () => mal(new Error('no pude conectar con el navegador')), { once: true })
    })
  }
  enviar(method, params = {}) {
    const id = ++this.id
    return new Promise((ok, mal) => { this.pendientes.set(id, { ok, mal }); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  on(evento, f) { if (!this.oyentes.has(evento)) this.oyentes.set(evento, []); this.oyentes.get(evento).push(f) }
  una(evento, ms) {
    return new Promise((ok, mal) => {
      const t = setTimeout(() => mal(new Error(`la página no terminó de cargar en ${Math.round(ms / 1000)} s`)), ms)
      this.on(evento, (p) => { clearTimeout(t); ok(p) })
    })
  }
  async evaluar(expr) {
    const r = await this.enviar('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('falló la medición: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result.value
  }
  cerrar() { try { this.ws.close() } catch {} }
}

async function lanzar(ejecutable, signal) {
  const perfil = await mkdtemp(path.join(tmpdir(), 'cristal-nav-'))
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--disable-extensions', '--disable-background-networking', '--force-color-profile=srgb', 'about:blank']
  if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox')
  const hijo = spawn(ejecutable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, signal })
  const wsUrl = await new Promise((ok, mal) => {
    let buf = ''
    const t = setTimeout(() => mal(new Error('el navegador no arrancó en 20 s')), 20_000)
    hijo.stderr.on('data', (d) => { buf += d.toString(); const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); ok(m[1]) } })
    hijo.on('error', (e) => { clearTimeout(t); mal(e) })
    hijo.on('exit', (c) => { clearTimeout(t); mal(new Error(`el navegador se cerró al arrancar (código ${c})`)) })
  })
  const puerto = new URL(wsUrl).port
  let pagina
  for (let i = 0; i < 40 && !pagina; i++) {
    try { pagina = (await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
    if (!pagina) await new Promise((r) => setTimeout(r, 150))
  }
  if (!pagina) { try { hijo.kill() } catch {} ; throw new Error('el navegador no abrió ninguna pestaña') }
  const cerrar = async () => {
    try { hijo.kill() } catch {}
    await new Promise((r) => setTimeout(r, 300))
    await rm(perfil, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {})
  }
  return { wsPagina: pagina.webSocketDebuggerUrl, cerrar }
}

// Se instala antes de que cargue la página: mide cuánto "salta" el diseño al cargar.
const ANTES = `window.__crCls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__crCls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch (e) {}`

// Animaciones que corren justo después de cargar + cómo se mueven los elementos interactivos.
export const MOVIMIENTO = String.raw`(() => {
  const out = [];
  const corto = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const desc = (el) => { if (!el || !el.tagName) return ''; let s = el.tagName.toLowerCase(); const c = [...el.classList].slice(0, 2).join('.'); if (c) s += '.' + c; const t = (el.innerText || '').trim().replace(/\s+/g, ' '); return t ? s + ' «' + corto(t, 40) + '»' : s; };
  const DISENO = /^(width|height|top|left|right|bottom|margin|padding|inset|maxHeight|maxWidth|minHeight|minWidth|fontSize|borderWidth|gap)/i;
  const GIRA = /cargando|spinner|loader|loading|esqueleto|skeleton|cr-boton/i;
  const vistos = new Set();
  const agregar = (tipo, gravedad, donde, detalle) => { const k = tipo + '|' + donde; if (vistos.has(k)) return; vistos.add(k); out.push({ tipo, gravedad, donde, detalle }); };
  let infinitas = 0, total = 0;
  for (const a of document.getAnimations()) {
    const ef = a.effect; if (!ef || !ef.getTiming) continue;
    const tm = ef.getTiming(); const el = ef.target;
    if (typeof tm.duration !== 'number') continue; // ligadas al scroll
    total++;
    const props = new Set();
    if (a.transitionProperty) props.add(a.transitionProperty.replace(/-([a-z])/g, (_, l) => l.toUpperCase()));
    try { for (const k of ef.getKeyframes()) for (const p of Object.keys(k)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p); } catch (e) {}
    const malas = [...props].filter((p) => DISENO.test(p));
    if (malas.length && !(el && el.closest && el.closest('.cr-progreso'))) agregar('anima propiedades que mueven el diseño', 'media', desc(el), 'anima ' + malas.join(', ') + '; usa transform y opacity para que vaya fluido');
    if (tm.iterations === Infinity) { if (!(el && GIRA.test((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) + ' ' + (el.getAttribute && el.getAttribute('role'))))) infinitas++; }
    else if (tm.duration > 900) agregar('animación demasiado lenta', 'media', desc(el), Math.round(tm.duration) + ' ms; las de interfaz van entre 150 y 500 ms');
    if (tm.delay > 1200) agregar('animación que tarda en empezar', 'baja', desc(el), 'empieza a los ' + Math.round(tm.delay) + ' ms');
  }
  if (infinitas > 2) agregar('demasiadas animaciones infinitas', 'media', '', infinitas + ' elementos se animan sin parar; distraen y gastan batería');
  // interactivos sin respuesta visual y transiciones "all"
  const interactivos = [...document.querySelectorAll('button, a[href], [role=button], .cr-tarjeta.interactiva')].filter((el) => el.getBoundingClientRect().width > 0);
  const sinTransicion = interactivos.filter((el) => getComputedStyle(el).transitionDuration.split(',').every((d) => parseFloat(d) === 0));
  if (interactivos.length >= 3 && sinTransicion.length / interactivos.length > 0.5) agregar('botones sin respuesta al tocarlos', 'baja', '', sinTransicion.length + ' de ' + interactivos.length + ' botones y enlaces no tienen transición al pasar el cursor o presionar (usa .cr-boton o transition en transform/background)');
  let todas = 0;
  for (const el of document.body.querySelectorAll('*')) { const s = getComputedStyle(el); if (/\ball\b/.test(s.transitionProperty) && parseFloat(s.transitionDuration) > 0) { todas++; if (todas === 1) agregar('usa transition: all', 'baja', desc(el), 'anima cualquier cambio, incluso de tamaño; nombra las propiedades (transform, opacity, background-color)'); } }
  return { problemas: out, total, saltos: Math.round((window.__crCls || 0) * 1000) / 1000 };
})()`

// Pone la página en reposo para medirla y fotografiarla: sin animaciones a medias.
const REPOSO = `(() => { const s = document.createElement('style'); s.id = '__cr-reposo'; s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(s); document.querySelectorAll('.cr-pendiente').forEach((e) => { e.classList.remove('cr-pendiente'); e.classList.add('cr-visto') }); return true })()`

const SIN_REDUCIR = String.raw`(() => {
  const out = [];
  for (const a of document.getAnimations()) {
    const tm = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
    if (!tm || typeof tm.duration !== 'number' || a.playState !== 'running') continue;
    if (tm.duration > 120 || tm.iterations === Infinity) { const el = a.effect.target; out.push(el && el.tagName ? el.tagName.toLowerCase() + ([...el.classList].length ? '.' + [...el.classList].slice(0, 2).join('.') : '') : '?'); }
  }
  return [...new Set(out)].slice(0, 4);
})()`

export const AUDITORIA = String.raw`(() => {
  const W = document.documentElement.clientWidth, out = [];
  const corto = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const textoDe = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
  const desc = (el) => {
    let s = el.tagName.toLowerCase();
    const c = [...el.classList].slice(0, 2).join('.'); if (c) s += '.' + c;
    const t = textoDe(el); return t ? s + ' «' + corto(t, 48) + '»' : s;
  };
  const cs = (el) => getComputedStyle(el);
  const visible = (el) => { const r = el.getBoundingClientRect(), s = cs(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const enScroll = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = cs(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const todos = [...document.body.querySelectorAll('*')].filter((el) => !['SCRIPT', 'STYLE', 'BR', 'TEMPLATE'].includes(el.tagName));
  const conTexto = todos.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && visible(el));
  const vistos = new Set();
  const agregar = (tipo, gravedad, el, detalle) => { const k = tipo + '|' + (el ? desc(el) : detalle); if (vistos.has(k)) return; vistos.add(k); out.push({ tipo, gravedad, donde: el ? desc(el) : '', detalle }); };

  // 1. Algo se sale del ancho de la pantalla (barra horizontal en toda la página)
  if (document.documentElement.scrollWidth > W + 2) {
    const fuera = todos.filter((el) => visible(el) && !enScroll(el) && el.getBoundingClientRect().right > W + 2);
    const hojas = fuera.filter((el) => !fuera.some((o) => o !== el && el.contains(o))).slice(0, 4);
    for (const el of hojas) agregar('se sale de la pantalla', 'alta', el, 'termina en ' + Math.round(el.getBoundingClientRect().right) + ' px y la pantalla mide ' + W + ' px');
  }
  // 2. Texto cortado (contenedor con overflow oculto más pequeño que su contenido)
  for (const el of todos) {
    if (!visible(el)) continue;
    const s = cs(el);
    const oculto = /hidden|clip/.test(s.overflowX + ' ' + s.overflowY);
    if (!oculto || !textoDe(el) || s.textOverflow === 'ellipsis') continue;
    const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
    if (dx > 3 || dy > 3) agregar('contenido cortado', 'alta', el, 'le faltan ' + Math.max(dx, dy) + ' px para mostrarse completo' + '');
  }
  // 3. Texto que se desborda de su caja (palabras largas, anchos fijos)
  for (const el of conTexto) {
    const s = cs(el); if (/hidden|clip|auto|scroll/.test(s.overflowX) || s.display === 'inline') continue;
    if (el.scrollWidth > el.clientWidth + 3 && el.clientWidth > 0) agregar('texto se desborda', 'alta', el, 'el texto mide ' + el.scrollWidth + ' px y su caja ' + el.clientWidth + ' px');
  }
  // 4. Textos encimados
  const cajas = conTexto.slice(0, 500).map((el) => ({ el, r: el.getBoundingClientRect() })).filter((c) => c.r.width > 2 && c.r.height > 2);
  let encimados = 0;
  for (let i = 0; i < cajas.length && encimados < 8; i++) for (let j = i + 1; j < cajas.length && encimados < 8; j++) {
    const a = cajas[i], b = cajas[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w <= 2 || h <= 2) continue;
    const menor = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
    if (w * h > menor * 0.25) { encimados++; agregar('textos encimados', 'alta', a.el, 'se monta sobre ' + desc(b.el)); }
  }
  // 5. Contraste bajo
  const rgba = (c) => {
    const m = c.match(/-?[\d.]+/g); if (!m) return null; const v = m.map(Number);
    if (/^color\(srgb/.test(c)) return { r: v[0] * 255, g: v[1] * 255, b: v[2] * 255, a: v.length > 3 ? v[3] : 1 };
    if (/^(rgb|rgba)\(/.test(c)) return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 };
    return null;
  };
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const fondo = (el) => { for (let p = el; p; p = p.parentElement) { const s = cs(p); if (s.backgroundImage && s.backgroundImage !== 'none') return null; const c = rgba(s.backgroundColor); if (c && c.a > 0.6) return c; } for (const e of [document.body, document.documentElement]) { const c = rgba(cs(e).backgroundColor); if (c && c.a > 0.6) return c; } return /dark/.test(cs(document.documentElement).colorScheme) && matchMedia('(prefers-color-scheme: dark)').matches ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }; };
  let bajos = 0;
  for (const el of conTexto) {
    if (bajos >= 6) break;
    const s = cs(el), c = rgba(s.color), f = fondo(el); if (!c || !f || c.a < 0.5) continue;
    const l1 = lum(c), l2 = lum(f), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const tam = parseFloat(s.fontSize), grande = tam >= 24 || (tam >= 18.6 && +s.fontWeight >= 600);
    if (ratio < (grande ? 3 : 4.5)) { bajos++; agregar('contraste bajo', 'media', el, 'relación ' + ratio.toFixed(1) + ':1 (mínimo ' + (grande ? 3 : 4.5) + ':1)'); }
  }
  // 6. Letra demasiado pequeña
  for (const el of conTexto) {
    const t = parseFloat(cs(el).fontSize), min = 11;
    if (t < min) agregar('letra muy pequeña', 'media', el, t + ' px (mínimo ' + min + ' px)');
  }
  // 7. Imágenes rotas
  for (const img of document.images) if (img.complete && img.naturalWidth === 0) agregar('imagen rota', 'alta', img, img.getAttribute('src') || '');
  // 8. Áreas de toque pequeñas (solo en celular): Apple y Google recomiendan 44 px
  if (W < 600) {
    let chicos = 0;
    const toques = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], summary')];
    for (const el of toques) {
      if (chicos >= 6 || !visible(el)) continue;
      const lab = el.closest('label'); if (lab && lab.getBoundingClientRect().height >= 40) continue;
      if (cs(el).display === 'inline' && el.parentElement && textoDe(el.parentElement).length > textoDe(el).length + 15) continue; // enlace dentro de un párrafo
      const r = el.getBoundingClientRect();
      if (r.right < 0 || r.left > W) continue;
      if (r.width < 40 || r.height < 40) { chicos++; agregar('área de toque pequeña', 'media', el, Math.round(r.width) + '×' + Math.round(r.height) + ' px (mínimo recomendado 44×44 en celular)'); }
    }
    for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')) {
      if (visible(el) && parseFloat(cs(el).fontSize) < 16) { agregar('el iPhone hace zoom al escribir', 'baja', el, 'letra de ' + parseFloat(cs(el).fontSize) + ' px en un campo; usa 16 px o más'); break; }
    }
  }
  // 9. ¿Carga el kit Cristal?
  const conKit = !!getComputedStyle(document.documentElement).getPropertyValue('--cr-acento-base').trim();
  if (!conKit) agregar('no carga el kit Cristal', 'media', null, 'importa cristal.css (y cristal.js) para tener los tokens, componentes y animaciones');
  const delKit = document.querySelectorAll('[class*="cr-"]').length;
  return { problemas: out, alto: Math.ceil(document.documentElement.scrollHeight), ancho: W, textos: conTexto.length, elementosKit: delKit, conKit };
})()`


export async function revisar(objetivo, { navegador, carpetaCapturas, base = 'pantalla', signal, maxAlto = 9000, esperaMs = 1200 } = {}) {
  if (!objetivoValido(objetivo)) throw new Error('solo reviso archivos del proyecto o servidores locales (http://localhost:… o http://127.0.0.1:…)')
  const ejecutable = buscarNavegador(navegador)
  if (!ejecutable) return { disponible: false, motivo: 'no encontré Edge, Chrome ni Chromium en este computador (configura "navegador" con la ruta del ejecutable)' }
  const url = /^https?:\/\//i.test(objetivo) ? objetivo : pathToFileURL(objetivo).href
  const { wsPagina, cerrar } = await lanzar(ejecutable, signal)
  let cdp
  try { cdp = await Cdp.abrir(wsPagina) } catch (e) { await cerrar(); throw e }
  const problemas = [], capturas = [], errores = [], medidas = {}
  let fallaRed = null
  try {
    await cdp.enviar('Page.enable'); await cdp.enviar('Runtime.enable'); await cdp.enviar('Network.enable')
    await cdp.enviar('Page.addScriptToEvaluateOnNewDocument', { source: ANTES })
    cdp.on('Runtime.exceptionThrown', (p) => errores.push(p.exceptionDetails?.exception?.description?.split('\n')[0] ?? p.exceptionDetails?.text ?? 'error'))
    cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errores.push((p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)) })
    cdp.on('Network.loadingFailed', (p) => { if (!p.canceled && p.type !== 'Ping') errores.push(`no cargó un recurso (${p.errorText})`) })
    cdp.on('Network.responseReceived', (p) => { if (p.response?.status >= 400 && p.type !== 'Fetch' && p.type !== 'XHR') errores.push(`${p.response.status} al cargar ${p.response.url.slice(0, 120)}`) })
    if (carpetaCapturas) await mkdir(carpetaCapturas, { recursive: true })
    for (const v of VISTAS) {
      await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: v.ancho, height: v.alto, deviceScaleFactor: 1, mobile: v.movil })
      await cdp.enviar('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v.tema }, { name: 'prefers-reduced-motion', value: 'no-preference' }] })
      const cargo = cdp.una('Page.loadEventFired', 25_000)
      cargo.catch(() => {})
      const nav = await cdp.enviar('Page.navigate', { url })
      if (nav.errorText) { fallaRed = nav.errorText; break }
      await cargo
      await new Promise((r) => setTimeout(r, 120))
      if (v.nombre === 'escritorio') {
        const m = await cdp.evaluar(MOVIMIENTO)
        medidas.animaciones = m.total
        for (const p of m.problemas) problemas.push({ ...p, vista: v.nombre })
        await new Promise((r) => setTimeout(r, esperaMs))
        const s = await cdp.evaluar('Math.round((window.__crCls || 0) * 1000) / 1000')
        medidas.saltos = s
        if (s > 0.1) problemas.push({ tipo: 'la página salta al cargar', gravedad: 'media', donde: '', detalle: `desplazamiento acumulado ${s} (bueno: menos de 0,1). Reserva el espacio de imágenes y datos que llegan después (alto fijo o esqueleto)`, vista: v.nombre })
      } else await new Promise((r) => setTimeout(r, Math.min(esperaMs, 700)))
      await cdp.evaluar(REPOSO)
      const a = await cdp.evaluar(AUDITORIA)
      medidas[v.nombre] = { alto: a.alto, textos: a.textos, elementosKit: a.elementosKit, conKit: a.conKit }
      for (const p of a.problemas) problemas.push({ ...p, vista: v.nombre })
      if (carpetaCapturas) {
        await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: v.ancho, height: Math.min(Math.max(a.alto, v.alto), maxAlto), deviceScaleFactor: 1, mobile: v.movil })
        await new Promise((r) => setTimeout(r, 150))
        const shot = await cdp.enviar('Page.captureScreenshot', { format: 'png' })
        const f = path.join(carpetaCapturas, `${base}-${v.nombre}.png`)
        await writeFile(f, Buffer.from(shot.data, 'base64'))
        capturas.push(f)
      }
    }
    // ¿respeta "reducir movimiento"?
    if (!fallaRed) {
      await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false })
      await cdp.enviar('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
      const cargo = cdp.una('Page.loadEventFired', 25_000)
      await cdp.enviar('Page.navigate', { url })
      await cargo
      await new Promise((r) => setTimeout(r, 150))
      const siguen = await cdp.evaluar(SIN_REDUCIR)
      if (siguen.length) problemas.push({ tipo: 'no respeta "reducir movimiento"', gravedad: 'media', donde: siguen.join(', '), detalle: 'hay personas que lo activan porque el movimiento las marea; desactiva o acorta esas animaciones con @media (prefers-reduced-motion: reduce)', vista: 'escritorio' })
    }
  } finally {
    cdp.cerrar()
    await cerrar()
  }
  if (fallaRed) return { disponible: true, navegador: ejecutable, problemas: [{ tipo: 'no abrió la página', gravedad: 'alta', donde: objetivo, detalle: `${fallaRed}. Si es un servidor de desarrollo, ¿está encendido (npm run dev)?`, vistas: ['escritorio'] }], capturas, medidas }
  for (const e of [...new Set(errores)].slice(0, 5)) problemas.push({ tipo: 'error en la página', gravedad: 'alta', donde: '', detalle: e, vista: 'escritorio' })
  return { disponible: true, navegador: ejecutable, problemas: unirVistas(problemas), capturas, medidas }
}

export function unirVistas(lista) {
  const m = new Map()
  for (const p of lista) {
    const k = `${p.tipo}|${p.donde}`
    if (m.has(k)) { const q = m.get(k); if (!q.vistas.includes(p.vista)) q.vistas.push(p.vista) } else m.set(k, { tipo: p.tipo, gravedad: p.gravedad, donde: p.donde, detalle: p.detalle, vistas: [p.vista] })
  }
  const orden = { alta: 0, media: 1, baja: 2 }
  return [...m.values()].sort((a, b) => orden[a.gravedad] - orden[b.gravedad])
}
