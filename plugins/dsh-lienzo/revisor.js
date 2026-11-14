// Revisor visual de dsh-lienzo: abre la página en Edge/Chrome invisible (el que ya
// tenga el computador, sin instalar nada), la mide en escritorio y celular, toma
// capturas y devuelve problemas concretos: cosas que se salen, texto cortado o
// encimado, contraste bajo, letra muy pequeña, errores de JavaScript, recursos de internet.
// Habla con el navegador por el protocolo DevTools usando el WebSocket que trae Node 22.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const VISTAS = [
  { nombre: 'escritorio', ancho: 1280, alto: 860, movil: false },
  { nombre: 'celular', ancho: 390, alto: 844, movil: true },
]

export function candidatosNavegador(env = process.env, plataforma = process.platform) {
  if (plataforma === 'win32') {
    const bases = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean)
    const rel = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'Chromium\\Application\\chrome.exe']
    return bases.flatMap((b) => rel.map((r) => path.win32.join(b, r)))
  }
  if (plataforma === 'darwin') {
    return ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser'].map((a) => `/Applications/${a}.app/Contents/MacOS/${a}`)
  }
  const dirs = String(env.PATH ?? '/usr/bin:/usr/local/bin').split(':')
  const nombres = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser']
  return [...nombres.flatMap((n) => dirs.map((d) => path.join(d, n))), '/snap/bin/chromium']
}

export function buscarNavegador(preferido) {
  if (preferido) return existsSync(preferido) ? preferido : null
  return candidatosNavegador().find((p) => existsSync(p)) ?? null
}

// ---------- cliente mínimo del protocolo DevTools ----------

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
      const t = setTimeout(() => mal(new Error(`el navegador no respondió (${evento})`)), ms)
      this.on(evento, (p) => { clearTimeout(t); ok(p) })
    })
  }
  cerrar() { try { this.ws.close() } catch {} }
}

async function lanzar(ejecutable, signal) {
  const perfil = await mkdtemp(path.join(tmpdir(), 'lienzo-nav-'))
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--disable-extensions', '--disable-background-networking', '--force-color-profile=srgb', 'about:blank']
  if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox')
  const hijo = spawn(ejecutable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, signal })
  const wsUrl = await new Promise((ok, mal) => {
    let buf = ''
    const t = setTimeout(() => mal(new Error('el navegador no arrancó en 20 s')), 20_000)
    hijo.stderr.on('data', (d) => {
      buf += d.toString()
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf)
      if (m) { clearTimeout(t); ok(m[1]) }
    })
    hijo.on('error', (e) => { clearTimeout(t); mal(e) })
    hijo.on('exit', (c) => { clearTimeout(t); mal(new Error(`el navegador se cerró al arrancar (código ${c})`)) })
  })
  const puerto = new URL(wsUrl).port
  // La pestaña inicial puede tardar un instante en aparecer.
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

// ---------- lo que se mide dentro de la página ----------

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
    if (!oculto || !textoDe(el)) continue;
    const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
    if (dx > 3 || dy > 3) agregar('contenido cortado', 'alta', el, 'le faltan ' + Math.max(dx, dy) + ' px para mostrarse completo' + (el.closest('.lz-pantalla') ? ' (dentro de una maqueta: quita contenido o acórtalo)' : ''));
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
  const fondo = (el) => { for (let p = el; p; p = p.parentElement) { const s = cs(p); if (s.backgroundImage && s.backgroundImage !== 'none') return null; const c = rgba(s.backgroundColor); if (c && c.a > 0.6) return c; } return rgba(cs(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; };
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
    const t = parseFloat(cs(el).fontSize), min = el.closest('.lz-pantalla') ? 10 : 12;
    if (t < min) agregar('letra muy pequeña', 'media', el, t + ' px (mínimo ' + min + ' px)');
  }
  // 7. Imágenes rotas
  for (const img of document.images) if (img.complete && img.naturalWidth === 0) agregar('imagen rota', 'alta', img, img.getAttribute('src') || '');
  // 8. Secciones vacías
  for (const s of document.querySelectorAll('.lz-seccion')) if (textoDe(s).length < 25) agregar('sección vacía', 'media', s, 'casi no tiene contenido');
  // 9. ¿Usa el kit?
  const delKit = document.querySelectorAll('[class*="lz-"]').length;
  if (delKit < 6) agregar('no usa el kit', 'media', null, 'solo ' + delKit + ' elementos usan clases lz-; arma la página con las piezas de lienzo_guia');
  return { problemas: out, alto: Math.ceil(document.documentElement.scrollHeight), ancho: W, textos: conTexto.length, elementosKit: delKit };
})()`

// Recursos que dependen de internet (la página debe abrir sin conexión).
export function recursosExternos(html) {
  const out = []
  const re = /<(script|link|img|iframe|video|audio|source)\b[^>]*?\b(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi
  let m
  while ((m = re.exec(html))) out.push(`${m[1]} → ${m[2]}`)
  const css = /@import\s+url\(\s*["']?((?:https?:)?\/\/[^"')]+)/gi
  while ((m = css.exec(html))) out.push(`@import → ${m[1]}`)
  return [...new Set(out)].slice(0, 6)
}

export async function revisar(archivo, { navegador, carpetaCapturas, base, signal, maxAlto = 9000 } = {}) {
  const ejecutable = buscarNavegador(navegador)
  if (!ejecutable) return { disponible: false, motivo: 'no encontré Edge, Chrome ni Chromium en este computador (configura "navegador" con la ruta del ejecutable)' }
  const { wsPagina, cerrar } = await lanzar(ejecutable, signal)
  let cdp
  try { cdp = await Cdp.abrir(wsPagina) } catch (e) { await cerrar(); throw e }
  const problemas = []
  const capturas = []
  const errores = []
  const medidas = {}
  try {
    await cdp.enviar('Page.enable')
    await cdp.enviar('Runtime.enable')
    cdp.on('Runtime.exceptionThrown', (p) => errores.push(p.exceptionDetails?.exception?.description?.split('\n')[0] ?? p.exceptionDetails?.text ?? 'error'))
    cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errores.push((p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)) })
    const url = pathToFileURL(archivo).href
    if (carpetaCapturas) await mkdir(carpetaCapturas, { recursive: true })
    for (const v of VISTAS) {
      await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: v.ancho, height: v.alto, deviceScaleFactor: 1, mobile: v.movil })
      await cdp.enviar('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
      const cargo = cdp.una('Page.loadEventFired', 20_000)
      await cdp.enviar('Page.navigate', { url })
      await cargo
      await new Promise((r) => setTimeout(r, 350))
      const r = await cdp.enviar('Runtime.evaluate', { expression: AUDITORIA, returnByValue: true })
      if (r.exceptionDetails) throw new Error('falló la medición: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
      const a = r.result.value
      medidas[v.nombre] = { alto: a.alto, textos: a.textos, elementosKit: a.elementosKit }
      for (const p of a.problemas) problemas.push({ ...p, vista: v.nombre })
      if (carpetaCapturas) {
        const alto = Math.min(a.alto, maxAlto)
        await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: v.ancho, height: alto, deviceScaleFactor: 1, mobile: v.movil })
        await new Promise((r2) => setTimeout(r2, 150))
        const shot = await cdp.enviar('Page.captureScreenshot', { format: 'png' })
        const f = path.join(carpetaCapturas, `${base ?? path.basename(archivo, '.html')}-${v.nombre}.png`)
        await writeFile(f, Buffer.from(shot.data, 'base64'))
        capturas.push(f)
      }
    }
  } finally {
    cdp.cerrar()
    await cerrar()
  }
  for (const e of [...new Set(errores)].slice(0, 5)) problemas.push({ tipo: 'error de JavaScript', gravedad: 'alta', donde: '', detalle: e, vista: 'escritorio' })
  return { disponible: true, navegador: ejecutable, problemas: unirVistas(problemas), capturas, medidas }
}

// El mismo problema en escritorio y celular se reporta una vez.
export function unirVistas(lista) {
  const m = new Map()
  for (const p of lista) {
    const k = `${p.tipo}|${p.donde}`
    if (m.has(k)) { const q = m.get(k); if (!q.vistas.includes(p.vista)) q.vistas.push(p.vista) } else m.set(k, { tipo: p.tipo, gravedad: p.gravedad, donde: p.donde, detalle: p.detalle, vistas: [p.vista] })
  }
  const orden = { alta: 0, media: 1, baja: 2 }
  return [...m.values()].sort((a, b) => orden[a.gravedad] - orden[b.gravedad])
}
