// Motor de dibujo de dsh-planos: recibe la estructura (nodos, conexiones, tablas)
// y devuelve un HTML autocontenido con el diagrama en SVG.
// Sin dependencias ni internet: se ve igual en el panel de dsh (aunque bloquee
// JavaScript), en el navegador o enviado por WhatsApp.

export const TIPOS = {
  flujo: 'Flujo de proceso',
  mapa: 'Mapa de la plataforma',
  arquitectura: 'Arquitectura',
  datos: 'Modelo de datos',
  recorrido: 'Recorrido del usuario',
}

export const FORMAS = ['inicio', 'fin', 'paso', 'decision', 'dato', 'externo', 'pantalla', 'actor', 'servicio', 'nota']

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const r1 = (n) => Math.round(n * 10) / 10

// Paleta clara en atributos (funciona aunque se quite el <style>); el modo oscuro va en CSS.
const COLOR = {
  inicio: ['#e7f6ec', '#2f8f57'], fin: ['#fdecec', '#c0473f'], paso: ['#ffffff', '#5b6b82'],
  decision: ['#fff6df', '#c58a10'], dato: ['#eaf2fd', '#3a73c4'], externo: ['#f3f1f8', '#7a6aa8'],
  pantalla: ['#ffffff', '#2d6cdf'], actor: ['#eef7f6', '#2a8a80'], servicio: ['#f1f5fb', '#44628f'],
  nota: ['#fffbe8', '#b19a3a'], tabla: ['#ffffff', '#3a73c4'],
}
const TINTA = '#1d2533'
const SUAVE = '#5d6878'
const LINEA = '#8a95a6'

// ---------- texto ----------

function partir(texto, maxCar) {
  const palabras = String(texto ?? '').replace(/\s+/g, ' ').trim().split(' ')
  const lineas = []
  let actual = ''
  for (let w of palabras) {
    while (w.length > maxCar) { // palabras larguísimas (rutas, nombres de tabla)
      if (actual) { lineas.push(actual); actual = '' }
      lineas.push(w.slice(0, maxCar - 1) + '-'); w = w.slice(maxCar - 1)
    }
    if (!actual) actual = w
    else if ((actual + ' ' + w).length <= maxCar) actual += ' ' + w
    else { lineas.push(actual); actual = w }
  }
  if (actual) lineas.push(actual)
  return lineas.length ? lineas : ['']
}

// ---------- disposición por capas (tipo Sugiyama simplificado) ----------

/**
 * nodos: [{ id, w, h, grupo }] con tamaño ya calculado; aristas: [{ desde, hacia }].
 * Devuelve posiciones de centro { x, y } y los carriles (grupos) con su caja.
 */
export function disponer(nodos, aristas, { vertical = true, gapCapa = 74, gapCruz = 34, padCarril = 22, conCarriles = true, bandas = false } = {}) {
  const idx = new Map(nodos.map((n, i) => [n.id, i]))
  const sal = nodos.map(() => []); const ent = nodos.map(() => [])
  for (const a of aristas) {
    const s = idx.get(a.desde); const t = idx.get(a.hacia)
    if (s === undefined || t === undefined || s === t) continue
    sal[s].push(t); ent[t].push(s)
  }
  // Aristas de retroceso (ciclos) por DFS en el orden dado.
  const color = nodos.map(() => 0); const atras = new Set()
  const dfs = (v) => {
    color[v] = 1
    for (const t of sal[v]) {
      if (color[t] === 1) atras.add(`${v}>${t}`)
      else if (color[t] === 0) dfs(t)
    }
    color[v] = 2
  }
  nodos.forEach((_, i) => { if (color[i] === 0 && ent[i].length === 0) dfs(i) })
  nodos.forEach((_, i) => { if (color[i] === 0) dfs(i) })
  // Capa = camino más largo desde una fuente (en el grafo sin ciclos).
  const fwd = nodos.map(() => []); const grado = nodos.map(() => 0)
  sal.forEach((ts, s) => ts.forEach((t) => {
    const [a, b] = atras.has(`${s}>${t}`) ? [t, s] : [s, t]
    fwd[a].push(b); grado[b]++
  }))
  const capa = nodos.map(() => 0)
  const cola = nodos.map((_, i) => i).filter((i) => grado[i] === 0)
  while (cola.length) {
    const v = cola.shift()
    for (const t of fwd[v]) { capa[t] = Math.max(capa[t], capa[v] + 1); if (--grado[t] === 0) cola.push(t) }
  }
  // Un nodo suelto sin conexiones no debe quedarse solo en la capa 0 si hay muchos: se deja así (orden de entrada).

  // Modo bandas (arquitectura): cada grupo es una capa completa (Usuarios, Frontend, Backend…),
  // ordenadas por su posición media en el flujo.
  let nombresBandas = []
  if (bandas && nodos.some((n) => n.grupo)) {
    const gs = []
    for (const n of nodos) { const g = n.grupo ?? ''; if (!gs.includes(g)) gs.push(g) }
    const media = new Map(gs.map((g) => {
      const cs = nodos.map((n, i) => (n.grupo ?? '') === g ? capa[i] : null).filter((x) => x !== null)
      return [g, cs.reduce((s, x) => s + x, 0) / cs.length + gs.indexOf(g) * 1e-3]
    }))
    nombresBandas = [...gs].sort((a, b) => media.get(a) - media.get(b))
    nodos.forEach((n, i) => { capa[i] = nombresBandas.indexOf(n.grupo ?? '') })
    conCarriles = false
  }

  const grupos = []
  for (const n of nodos) { const g = conCarriles ? (n.grupo ?? '') : ''; if (!grupos.includes(g)) grupos.push(g) }
  const hayCarriles = grupos.length > 1 || (grupos[0] ?? '') !== ''
  const carrilDe = nodos.map((n) => grupos.indexOf(conCarriles ? (n.grupo ?? '') : ''))
  const nCapas = Math.max(0, ...capa) + 1

  // tamaños en ejes abstractos: a = eje de capas, c = eje cruzado
  const tamA = (i) => vertical ? nodos[i].h : nodos[i].w
  const tamC = (i) => vertical ? nodos[i].w : nodos[i].h

  const celdas = new Map() // "carril|capa" -> [i]
  nodos.forEach((_, i) => {
    const k = `${carrilDe[i]}|${capa[i]}`
    if (!celdas.has(k)) celdas.set(k, [])
    celdas.get(k).push(i)
  })

  const tituloBanda = nombresBandas.length ? 30 : 0
  const grosorCapa = Array.from({ length: nCapas }, (_, l) => Math.max(0, ...nodos.map((_, i) => capa[i] === l ? tamA(i) : 0)) + tituloBanda)
  const cabecera = hayCarriles ? 40 : 0
  const posA = []
  const inicioCapa = []
  let a = cabecera + 24
  for (let l = 0; l < nCapas; l++) { inicioCapa[l] = a; posA[l] = a + tituloBanda + (grosorCapa[l] - tituloBanda) / 2; a += grosorCapa[l] + gapCapa }
  const largoA = a - gapCapa + 24

  const anchoCelda = (lista) => lista.reduce((s, i) => s + tamC(i), 0) + gapCruz * Math.max(0, lista.length - 1)
  const anchoCarril = grupos.map((_, g) => Math.max(160, ...[...celdas.entries()].filter(([k]) => k.startsWith(`${g}|`)).map(([, v]) => anchoCelda(v))) + padCarril * 2)
  const inicioCarril = []
  let c = 0
  for (let g = 0; g < grupos.length; g++) { inicioCarril[g] = c; c += anchoCarril[g] + (hayCarriles ? 14 : 0) }
  const largoC = c - (hayCarriles ? 14 : 0)

  const posC = nodos.map(() => 0)
  const colocar = () => {
    for (const [k, lista] of celdas) {
      const g = Number(k.split('|')[0])
      let x = inicioCarril[g] + (anchoCarril[g] - anchoCelda(lista)) / 2
      for (const i of lista) { posC[i] = x + tamC(i) / 2; x += tamC(i) + gapCruz }
    }
  }
  colocar()
  // Barridos de baricentro para reducir cruces dentro de cada celda.
  const vecinos = (i, haciaAbajo) => haciaAbajo ? ent[i] : sal[i]
  for (let barrido = 0; barrido < 6; barrido++) {
    const abajo = barrido % 2 === 0
    for (const lista of celdas.values()) {
      const bc = new Map(lista.map((i) => {
        const vs = vecinos(i, abajo).filter((v) => capa[v] !== capa[i])
        return [i, vs.length ? vs.reduce((s, v) => s + posC[v], 0) / vs.length : posC[i]]
      }))
      lista.sort((x, y) => bc.get(x) - bc.get(y))
    }
    colocar()
  }

  const pos = nodos.map((_, i) => vertical ? { x: posC[i], y: posA[capa[i]] } : { x: posA[capa[i]], y: posC[i] })
  if (nombresBandas.length) {
    const bandasGeo = nombresBandas.map((g, l) => vertical
      ? { nombre: g, banda: true, x: 0, y: inicioCapa[l] - 14, w: largoC, h: grosorCapa[l] + 28 }
      : { nombre: g, banda: true, x: inicioCapa[l] - 14, y: 0, w: grosorCapa[l] + 28, h: largoC })
    return { pos, capa, carriles: bandasGeo, ancho: vertical ? largoC : largoA, alto: vertical ? largoA : largoC, atras }
  }
  const carriles = hayCarriles ? grupos.map((g, k) => vertical
    ? { nombre: g, x: inicioCarril[k], y: 0, w: anchoCarril[k], h: largoA }
    : { nombre: g, x: 0, y: inicioCarril[k], w: largoA, h: anchoCarril[k] }) : []
  return { pos, capa, carriles, ancho: vertical ? largoC : largoA, alto: vertical ? largoA : largoC, atras }
}

// ---------- geometría de aristas ----------

function puntoBezier(p0, p1, p2, p3, t) {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

function camino(sn, tn, ps, pt, vertical, retro, limite) {
  if (!retro) {
    if (vertical) {
      const p0 = { x: ps.x, y: ps.y + sn.h / 2 }; const p3 = { x: pt.x, y: pt.y - tn.h / 2 - 4 }
      const d = Math.max(30, (p3.y - p0.y) / 2)
      return [p0, { x: p0.x, y: p0.y + d }, { x: p3.x, y: p3.y - d }, p3]
    }
    const p0 = { x: ps.x + sn.w / 2, y: ps.y }; const p3 = { x: pt.x - tn.w / 2 - 4, y: pt.y }
    const d = Math.max(30, (p3.x - p0.x) / 2)
    return [p0, { x: p0.x + d, y: p0.y }, { x: p3.x - d, y: p3.y }, p3]
  }
  // Retroceso o misma capa: sale por el costado y rodea todo lo que hay entre medio
  // (limite = borde exterior de los nodos de esas capas).
  if (vertical) {
    const p0 = { x: ps.x + sn.w / 2, y: ps.y }; const p3 = { x: pt.x + tn.w / 2 + 4, y: pt.y }
    const xc = (limite + 34 - 0.125 * (p0.x + p3.x)) / 0.75
    return [p0, { x: xc, y: p0.y }, { x: xc, y: p3.y }, p3]
  }
  const p0 = { x: ps.x, y: ps.y + sn.h / 2 }; const p3 = { x: pt.x, y: pt.y + tn.h / 2 + 4 }
  const yc = (limite + 34 - 0.125 * (p0.y + p3.y)) / 0.75
  return [p0, { x: p0.x, y: yc }, { x: p3.x, y: yc }, p3]
}

// ---------- nodos ----------

function medirNodo(n) {
  const forma = FORMAS.includes(n.tipo) ? n.tipo : 'paso'
  const ancho = forma === 'decision' ? 210 : forma === 'actor' ? 150 : 190
  const maxCar = forma === 'decision' ? 18 : forma === 'actor' ? 16 : 24
  const lineas = partir(n.etiqueta ?? n.id, maxCar).slice(0, 5)
  let alto = 22 + lineas.length * 17
  if (forma === 'pantalla') alto += 14
  if (forma === 'decision') alto = Math.max(84, alto + 34)
  if (forma === 'dato') alto += 16
  if (forma === 'actor') alto += 36
  if (n.estado === 'propuesta') alto += 14
  return { forma, w: ancho, h: alto, lineas }
}

function dibujarNodo(n, m, p, numero) {
  const { forma, w, h, lineas } = m
  const [fondo, borde] = COLOR[forma] ?? COLOR.paso
  const x = p.x - w / 2; const y = p.y - h / 2
  const prop = n.estado === 'propuesta'
  const trazo = `stroke="${borde}" stroke-width="1.6"${prop || forma === 'externo' ? ' stroke-dasharray="6 4"' : ''}`
  const cls = `nodo f-${forma}${prop ? ' propuesta' : ''}`
  let figura = ''
  let textoY = p.y - ((lineas.length - 1) * 17) / 2 + 5
  if (forma === 'inicio' || forma === 'fin') figura = `<rect class="fig" x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="${fondo}" ${trazo}/>`
  else if (forma === 'decision') figura = `<polygon class="fig" points="${r1(p.x)},${r1(y)} ${r1(x + w)},${r1(p.y)} ${r1(p.x)},${r1(y + h)} ${r1(x)},${r1(p.y)}" fill="${fondo}" ${trazo}/>`
  else if (forma === 'dato') {
    figura = `<path class="fig" d="M${r1(x)},${r1(y + 9)} a${w / 2},9 0 0,1 ${w},0 v${h - 18} a${w / 2},9 0 0,1 ${-w},0 z" fill="${fondo}" ${trazo}/><path d="M${r1(x)},${r1(y + 9)} a${w / 2},9 0 0,0 ${w},0" fill="none" ${trazo}/>`
    textoY += 6
  } else if (forma === 'pantalla') {
    figura = `<rect class="fig" x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="8" fill="${fondo}" ${trazo}/><rect class="barra" x="${r1(x)}" y="${r1(y)}" width="${w}" height="14" rx="8" fill="${borde}"/><rect class="barra" x="${r1(x)}" y="${r1(y + 7)}" width="${w}" height="7" fill="${borde}"/>` +
      [0, 1, 2].map((k) => `<circle cx="${r1(x + 10 + k * 9)}" cy="${r1(y + 7)}" r="2.4" fill="#ffffff" opacity=".85"/>`).join('')
    textoY += 7
  } else if (forma === 'actor') {
    figura = `<rect class="fig" x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="14" fill="${fondo}" ${trazo}/><circle cx="${r1(p.x)}" cy="${r1(y + 17)}" r="8" fill="none" stroke="${borde}" stroke-width="1.8"/><path d="M${r1(p.x - 13)},${r1(y + 40)} q13,-17 26,0" fill="none" stroke="${borde}" stroke-width="1.8"/>`
    textoY += 18
  } else if (forma === 'nota') figura = `<path class="fig" d="M${r1(x)},${r1(y)} h${w - 16} l16,16 v${h - 16} h${-w} z" fill="${fondo}" ${trazo}/>`
  else figura = `<rect class="fig" x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="${forma === 'servicio' ? 4 : 10}" fill="${fondo}" ${trazo}/>`
  if (prop) textoY -= 6
  const texto = lineas.map((l, k) => `<tspan x="${r1(p.x)}" y="${r1(textoY + k * 17)}">${esc(l)}</tspan>`).join('')
  const insignia = prop ? `<text class="insignia" x="${r1(p.x)}" y="${r1(y + h - 8)}" text-anchor="middle" font-size="10.5" fill="${borde}" font-weight="600">PROPUESTA</text>` : ''
  const num = `<text class="num" x="${r1(x + (forma === 'decision' ? w / 2 - 6 : 9))}" y="${r1(y + (forma === 'pantalla' ? 27 : forma === 'decision' ? 22 : 15))}" font-size="10" fill="${SUAVE}" text-anchor="${forma === 'decision' ? 'end' : 'start'}">${numero}</text>`
  const titulo = `<title>${esc([n.etiqueta ?? n.id, n.detalle, n.ref].filter(Boolean).join('\n'))}</title>`
  return `<g class="${cls}" id="n-${esc(n.id)}" data-id="${esc(n.id)}">${titulo}${figura}<text class="et" text-anchor="middle" font-size="13" fill="${TINTA}">${texto}</text>${num}${insignia}</g>`
}

// ---------- tablas (modelo de datos) ----------

function medirTabla(t) {
  const campos = (t.campos ?? []).slice(0, 40)
  const w = Math.min(320, Math.max(200, ...campos.map((f) => 64 + (String(f.nombre).length + String(f.tipo ?? '').length) * 7.1), String(t.nombre).length * 8.5 + 40))
  return { forma: 'tabla', w, h: 34 + Math.max(1, campos.length) * 21 + 8 + (t.estado === 'propuesta' ? 14 : 0), campos }
}

function dibujarTabla(t, m, p) {
  const [, borde] = COLOR.tabla
  const x = p.x - m.w / 2; const y = p.y - m.h / 2
  const prop = t.estado === 'propuesta'
  const filas = m.campos.map((f, k) => {
    const fy = y + 34 + k * 21 + 15
    const marca = f.pk ? 'PK' : f.fk ? 'FK' : ''
    return `<g class="campo"><title>${esc([f.nombre, f.tipo, f.fk ? `→ ${f.fk}` : '', f.nota].filter(Boolean).join(' · '))}</title>` +
      (marca ? `<text class="marca-${marca.toLowerCase()}" x="${r1(x + 10)}" y="${r1(fy)}" font-size="9.5" font-weight="700" fill="${f.pk ? '#c58a10' : '#3a73c4'}">${marca}</text>` : '') +
      `<text x="${r1(x + 34)}" y="${r1(fy)}" font-size="12.5" fill="${TINTA}"${f.pk ? ' font-weight="600"' : ''}>${esc(f.nombre)}</text>` +
      `<text x="${r1(x + m.w - 10)}" y="${r1(fy)}" font-size="11.5" fill="${SUAVE}" text-anchor="end">${esc(f.tipo ?? '')}</text></g>`
  }).join('')
  const separadores = m.campos.slice(1).map((_, k) => `<line x1="${r1(x)}" x2="${r1(x + m.w)}" y1="${r1(y + 34 + (k + 1) * 21)}" y2="${r1(y + 34 + (k + 1) * 21)}" stroke="#e3e8ef" class="sep"/>`).join('')
  return `<g class="nodo f-tabla${prop ? ' propuesta' : ''}" id="n-${esc(t.nombre)}" data-id="${esc(t.nombre)}"><title>${esc([t.nombre, t.descripcion].filter(Boolean).join('\n'))}</title>` +
    `<rect class="fig" x="${r1(x)}" y="${r1(y)}" width="${r1(m.w)}" height="${m.h}" rx="8" fill="#ffffff" stroke="${borde}" stroke-width="1.6"${prop ? ' stroke-dasharray="6 4"' : ''}/>` +
    `<path class="cab" d="M${r1(x)},${r1(y + 34)} v-26 a8,8 0 0,1 8,-8 h${r1(m.w - 16)} a8,8 0 0,1 8,8 v26 z" fill="${borde}"/>` +
    `<text class="cab-t" x="${r1(p.x)}" y="${r1(y + 22)}" text-anchor="middle" font-size="13.5" font-weight="700" fill="#ffffff">${esc(t.nombre)}</text>` +
    separadores + filas +
    (prop ? `<text class="insignia" x="${r1(p.x)}" y="${r1(y + m.h - 6)}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${borde}">PROPUESTA</text>` : '') + '</g>'
}

// ---------- validación ----------

export function validar(plano) {
  const errores = []
  const tipo = plano.tipo
  if (!TIPOS[tipo]) errores.push(`"tipo" debe ser uno de: ${Object.keys(TIPOS).join(', ')}`)
  if (!String(plano.titulo ?? '').trim()) errores.push('falta "titulo"')
  if (tipo === 'datos') {
    const tablas = plano.tablas ?? []
    if (!tablas.length) errores.push('el tipo "datos" necesita "tablas"')
    const nombres = new Set()
    for (const t of tablas) {
      if (!t?.nombre) errores.push('hay una tabla sin "nombre"')
      else if (nombres.has(t.nombre)) errores.push(`tabla repetida: ${t.nombre}`)
      nombres.add(t?.nombre)
    }
    for (const t of tablas) for (const f of t.campos ?? []) {
      if (f?.fk && !nombres.has(String(f.fk).split('.')[0])) errores.push(`${t.nombre}.${f.nombre} apunta a una tabla que no existe: ${f.fk}`)
    }
    for (const r of plano.relaciones ?? []) {
      if (!nombres.has(r.desde) || !nombres.has(r.hacia)) errores.push(`relación con tabla inexistente: ${r.desde} → ${r.hacia}`)
    }
  } else if (TIPOS[tipo]) {
    const nodos = plano.nodos ?? []
    if (!nodos.length) errores.push(`el tipo "${tipo}" necesita "nodos"`)
    if (nodos.length > 120) errores.push('máximo 120 nodos por plano; divide en varios planos')
    const ids = new Set()
    for (const n of nodos) {
      if (!n?.id) errores.push(`hay un nodo sin "id" (${JSON.stringify(n?.etiqueta ?? n)})`)
      else if (ids.has(n.id)) errores.push(`id repetido: ${n.id}`)
      ids.add(n?.id)
    }
    for (const c of plano.conexiones ?? []) {
      if (!ids.has(c?.desde)) errores.push(`conexión desde un id que no existe: ${c?.desde}`)
      if (!ids.has(c?.hacia)) errores.push(`conexión hacia un id que no existe: ${c?.hacia}`)
    }
  }
  return errores
}

// ---------- página ----------

const CSS = `
:root{--bg:#f6f7f9;--panel:#ffffff;--tinta:#1d2533;--suave:#5d6878;--borde:#dfe4ec;--acento:#2d6cdf;--carril:#eef1f6}
@media (prefers-color-scheme: dark){:root{--bg:#121519;--panel:#1a1e24;--tinta:#e7ebf1;--suave:#9aa5b5;--borde:#2c333d;--acento:#7aa7ff;--carril:#1d2229}
 svg .fig{fill:#20262e!important} svg .f-tabla .fig{fill:#1c2128!important} svg text{fill:var(--tinta)} svg .num,svg .tipo-dato{fill:var(--suave)!important}
 svg .sep{stroke:#2c333d} svg .carril-fondo{fill:#181c22!important;stroke:#2a3038!important} svg .et-arista-fondo{fill:#121519!important}
 svg .cab-t{fill:#ffffff!important} svg .marca-pk{fill:#e0a530!important} svg .marca-fk{fill:#7aa7ff!important} svg .insignia{fill:#e0a530!important}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tinta);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{padding:22px 20px 8px;max-width:1100px;margin:0 auto}
.tipo{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--acento);font-weight:700}
h1{font-size:24px;line-height:1.25;margin:4px 0 6px}
.desc{color:var(--suave);margin:0 0 6px;max-width:75ch}
.meta{font-size:12.5px;color:var(--suave)}
.lienzo{margin:10px auto 0;max-width:1100px;padding:0 12px}
.marco{background:var(--panel);border:1px solid var(--borde);border-radius:12px;overflow:auto;padding:8px}
.marco svg{display:block;margin:0 auto;max-width:100%;height:auto}
.marco.real svg{max-width:none}
.controles{display:flex;gap:8px;justify-content:flex-end;margin:0 0 6px}
.controles button{font:inherit;font-size:13px;border:1px solid var(--borde);background:var(--panel);color:var(--tinta);border-radius:8px;padding:3px 10px;cursor:pointer}
.leyenda{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--suave);margin:10px 4px 0}
.leyenda span{display:inline-flex;align-items:center;gap:6px}
.leyenda i{display:inline-block;width:18px;height:12px;border:1.6px solid var(--suave);border-radius:3px}
.leyenda i.prop{border-style:dashed}
section{max-width:1100px;margin:18px auto;padding:0 20px}
h2{font-size:17px;margin:0 0 8px}
details{background:var(--panel);border:1px solid var(--borde);border-radius:10px;margin:0 0 6px;padding:8px 12px}
details summary{cursor:pointer;font-weight:600}
details summary .n{color:var(--suave);font-weight:500;margin-right:6px}
details .chip{font-size:11px;font-weight:700;color:#b06b00;margin-left:6px}
details p{margin:6px 0 2px;color:var(--suave)}
details code{font-size:12.5px}
details ul{margin:4px 0 0;padding-left:18px;color:var(--suave);font-size:13.5px}
details.activo{border-color:var(--acento);box-shadow:0 0 0 2px color-mix(in srgb,var(--acento) 25%,transparent)}
table.campos{border-collapse:collapse;font-size:13px;margin-top:6px;width:100%}
table.campos td{border-top:1px solid var(--borde);padding:3px 6px}
.notas li{margin:2px 0}
footer{max-width:1100px;margin:10px auto 30px;padding:0 20px;font-size:12px;color:var(--suave)}
svg .nodo{cursor:pointer}
svg.atenuado .nodo:not(.sel):not(.vec),svg.atenuado .arista:not(.vec){opacity:.18}
svg .nodo.sel .fig{stroke-width:3}
@media print{.controles{display:none}.marco{overflow:visible;border:none}}
`

const JS = `
(function(){
var svg=document.querySelector('.marco svg'); if(!svg) return;
var marco=document.querySelector('.marco');
var btn=document.getElementById('zoom');
if(btn) btn.addEventListener('click',function(){marco.classList.toggle('real');btn.textContent=marco.classList.contains('real')?'Ajustar al ancho':'Tamaño real'});
function limpiar(){svg.classList.remove('atenuado');svg.querySelectorAll('.sel,.vec').forEach(function(e){e.classList.remove('sel','vec')});document.querySelectorAll('details.activo').forEach(function(d){d.classList.remove('activo')})}
svg.addEventListener('click',function(ev){
  var g=ev.target.closest('.nodo'); limpiar(); if(!g) return;
  var id=g.getAttribute('data-id'); g.classList.add('sel'); svg.classList.add('atenuado');
  svg.querySelectorAll('.arista').forEach(function(a){ if(a.getAttribute('data-desde')===id||a.getAttribute('data-hacia')===id){a.classList.add('vec');
    var o=a.getAttribute('data-desde')===id?a.getAttribute('data-hacia'):a.getAttribute('data-desde');
    var n=svg.querySelector('.nodo[data-id="'+(window.CSS&&CSS.escape?CSS.escape(o):o)+'"]'); if(n) n.classList.add('vec')}});
  var d=document.getElementById('d-'+id); if(d){d.open=true;d.classList.add('activo');d.scrollIntoView({behavior:'smooth',block:'nearest'})}
});
document.addEventListener('keydown',function(e){if(e.key==='Escape')limpiar()});
})();
`

export function renderizar(plano, { fecha = new Date() } = {}) {
  const vertical = plano.direccion !== 'horizontal'
  const esDatos = plano.tipo === 'datos'
  let items, aristas
  if (esDatos) {
    items = (plano.tablas ?? []).map((t) => ({ id: t.nombre, grupo: t.grupo, dato: t, m: medirTabla(t) }))
    aristas = []
    const vistas = new Set()
    for (const t of plano.tablas ?? []) for (const f of t.campos ?? []) {
      if (!f.fk) continue
      const destino = String(f.fk).split('.')[0]
      const k = `${t.nombre}>${destino}`
      if (vistas.has(k)) continue
      vistas.add(k)
      aristas.push({ desde: destino, hacia: t.nombre, etiqueta: f.cardinalidad ?? '1:N', campo: f.nombre })
    }
    for (const r of plano.relaciones ?? []) {
      const k = `${r.hacia}>${r.desde}`
      if (vistas.has(k) || vistas.has(`${r.desde}>${r.hacia}`)) continue
      vistas.add(k)
      aristas.push({ desde: r.desde, hacia: r.hacia, etiqueta: r.cardinalidad ?? r.etiqueta ?? '' })
    }
  } else {
    items = (plano.nodos ?? []).map((n) => ({ id: n.id, grupo: n.grupo, dato: n, m: medirNodo(n) }))
    aristas = (plano.conexiones ?? []).map((c) => ({ ...c }))
  }

  const lay = disponer(items.map((it) => ({ id: it.id, w: it.m.w, h: it.m.h, grupo: it.grupo })), aristas, { vertical, gapCapa: esDatos ? 90 : 74, gapCruz: esDatos ? 46 : 34, bandas: plano.tipo === 'arquitectura' })
  const MARGEN = 30
  let maxX = lay.ancho + MARGEN * 2; let maxY = lay.alto + MARGEN * 2
  const off = (p) => ({ x: p.x + MARGEN, y: p.y + MARGEN })
  const porId = new Map(items.map((it, i) => [it.id, { it, p: off(lay.pos[i]), i }]))

  const carriles = lay.carriles.map((c) => {
    const x = c.x + MARGEN - 8; const y = c.y + MARGEN - 8
    const etiquetaPos = c.banda ? `x="${r1(x + 14)}" y="${r1(y + 22)}"` : vertical ? `x="${r1(x + c.w / 2 + 8)}" y="${r1(y + 26)}" text-anchor="middle"` : `x="${r1(x + 14)}" y="${r1(y + 22)}"`
    return `<g class="carril"><rect class="carril-fondo" x="${r1(x)}" y="${r1(y)}" width="${r1(c.w + 16)}" height="${r1(c.h + 16)}" rx="12" fill="#f3f5f9" stroke="#e1e6ee"/>` +
      `<text ${etiquetaPos} font-size="12.5" font-weight="700" fill="${SUAVE}" letter-spacing=".04em">${esc((c.nombre || 'Sin grupo').toUpperCase())}</text></g>`
  }).join('')

  const lineas = []; const etiquetas = []
  aristas.forEach((a) => {
    const s = porId.get(a.desde); const t = porId.get(a.hacia)
    if (!s || !t || s === t) return
    const retro = lay.capa[t.i] <= lay.capa[s.i]
    let limite = 0
    if (retro) {
      const lo = Math.min(lay.capa[s.i], lay.capa[t.i]); const hi = Math.max(lay.capa[s.i], lay.capa[t.i])
      items.forEach((o, k) => {
        if (lay.capa[k] < lo || lay.capa[k] > hi) return
        const q = off(lay.pos[k])
        limite = Math.max(limite, vertical ? q.x + o.m.w / 2 : q.y + o.m.h / 2)
      })
    }
    const pts = camino(s.it.m, t.it.m, s.p, t.p, vertical, retro, limite)
    const [p0, p1, p2, p3] = pts
    // Aristas que saltan capas: si algo se interpone, rodearlo por el lado más corto.
    let d = `M${r1(p0.x)},${r1(p0.y)} C${r1(p1.x)},${r1(p1.y)} ${r1(p2.x)},${r1(p2.y)} ${r1(p3.x)},${r1(p3.y)}`
    let puntoEtiqueta = null
    if (!retro && lay.capa[t.i] - lay.capa[s.i] > 1) {
      const A = vertical ? 'y' : 'x'; const C = vertical ? 'x' : 'y'; const tamC = (m) => vertical ? m.w : m.h
      const lo = Math.min(p0[C], p3[C]) - 14; const hi = Math.max(p0[C], p3[C]) + 14
      const estorbos = items.map((o, k) => ({ o, k, q: off(lay.pos[k]) }))
        .filter(({ k }) => lay.capa[k] > lay.capa[s.i] && lay.capa[k] < lay.capa[t.i])
        .map(({ o, q }) => [q[C] - tamC(o.m) / 2, q[C] + tamC(o.m) / 2])
      if (estorbos.some(([a, b]) => b > lo && a < hi)) {
        const izq = Math.min(...estorbos.map(([a]) => a)) - 26; const der = Math.max(...estorbos.map(([, b]) => b)) + 26
        const lado = Math.abs(p0[C] - izq) + Math.abs(p3[C] - izq) < Math.abs(p0[C] - der) + Math.abs(p3[C] - der) && izq > 0 ? izq : der
        const w = { [C]: lado, [A]: (p0[A] + p3[A]) / 2 }
        const k1 = (w[A] - p0[A]) / 2; const k2 = (p3[A] - w[A]) / 2
        const P = (o) => vertical ? `${r1(o.x)},${r1(o.y)}` : `${r1(o.x)},${r1(o.y)}`
        const c1 = { [C]: p0[C], [A]: p0[A] + k1 }; const c2 = { [C]: lado, [A]: w[A] - k1 }
        const c3 = { [C]: lado, [A]: w[A] + k2 }; const c4 = { [C]: p3[C], [A]: p3[A] - k2 }
        d = `M${P(p0)} C${P(c1)} ${P(c2)} ${P(w)} C${P(c3)} ${P(c4)} ${P(p3)}`
        puntoEtiqueta = { ...w }
        maxX = Math.max(maxX, w.x + 10); maxY = Math.max(maxY, w.y + 10)
      }
    }
    const estilo = a.tipo === 'opcional' ? ' stroke-dasharray="5 4"' : a.tipo === 'datos' ? ' stroke-dasharray="2 3"' : ''
    maxX = Math.max(maxX, puntoBezier(p0, p1, p2, p3, 0.5).x + 10); maxY = Math.max(maxY, puntoBezier(p0, p1, p2, p3, 0.5).y + 10)
    lineas.push(`<path class="arista" data-desde="${esc(a.desde)}" data-hacia="${esc(a.hacia)}" d="${d}" fill="none" stroke="${LINEA}" stroke-width="1.5"${estilo} marker-end="url(#flecha)"><title>${esc(`${a.desde} → ${a.hacia}${a.etiqueta ? `: ${a.etiqueta}` : ''}`)}</title></path>`)
    if (a.etiqueta) {
      const txt = partir(a.etiqueta, 22).slice(0, 2)
      const ancho = Math.max(...txt.map((l) => l.length)) * 6.6 + 12
      const alto = txt.length * 14 + 6
      const m = puntoEtiqueta ?? puntoBezier(p0, p1, p2, p3, 0.5)
      // En los retrocesos la etiqueta va por fuera de la curva, no encima de los nodos.
      if (retro) { if (vertical) m.x += ancho / 2 + 4; else m.y += alto / 2 + 4 }
      maxX = Math.max(maxX, m.x + ancho / 2 + 10); maxY = Math.max(maxY, m.y + alto / 2 + 10)
      etiquetas.push(`<g class="et-arista"><rect class="et-arista-fondo" x="${r1(m.x - ancho / 2)}" y="${r1(m.y - alto / 2)}" width="${r1(ancho)}" height="${alto}" rx="5" fill="#f6f7f9"/>` +
        txt.map((l, k) => `<text x="${r1(m.x)}" y="${r1(m.y - alto / 2 + 14 + k * 14)}" text-anchor="middle" font-size="11.5" fill="${SUAVE}">${esc(l)}</text>`).join('') + '</g>')
    }
  })

  const W = Math.ceil(maxX + 10); const H = Math.ceil(maxY + 10)
  const cuerpos = items.map((it, k) => {
    const p = off(lay.pos[k])
    return esDatos ? dibujarTabla(it.dato, it.m, p) : dibujarNodo(it.dato, it.m, p, k + 1)
  }).join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="min-width:${Math.round(Math.min(W, 1500) * 0.62)}px" role="img" aria-label="${esc(plano.titulo)}" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">` +
    `<defs><marker id="flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${LINEA}"/></marker></defs>` +
    carriles + `<g class="aristas">${lineas.join('')}</g>` + cuerpos + etiquetas.join('') + '</svg>'

  // Leyenda: solo lo que aparece.
  const formasUsadas = esDatos ? [] : [...new Set(items.map((it) => it.m.forma))]
  const NOMBRE_FORMA = { inicio: 'Inicio', fin: 'Fin', paso: 'Paso', decision: 'Decisión', dato: 'Datos / base de datos', externo: 'Sistema externo', pantalla: 'Pantalla', actor: 'Persona / rol', servicio: 'Servicio', nota: 'Nota' }
  const hayProp = (esDatos ? plano.tablas : plano.nodos).some((n) => n.estado === 'propuesta')
  const leyenda = [
    ...formasUsadas.map((f) => `<span><i style="border-color:${COLOR[f][1]};background:${COLOR[f][0]};${f === 'decision' ? 'transform:rotate(45deg) scale(.75);' : ''}${f === 'inicio' || f === 'fin' ? 'border-radius:7px;' : ''}${f === 'externo' ? 'border-style:dashed;' : ''}"></i>${NOMBRE_FORMA[f]}</span>`),
    hayProp ? '<span><i class="prop"></i>Propuesta (aún no existe)</span>' : '',
    esDatos ? '<span><b style="color:#c58a10;font-size:11px">PK</b> llave primaria</span><span><b style="color:#3a73c4;font-size:11px">FK</b> llave foránea</span>' : '',
  ].filter(Boolean).join('')

  // Detalle de cada elemento (funciona sin JavaScript).
  const salidas = new Map(); const entradas = new Map()
  for (const a of aristas) {
    if (!salidas.has(a.desde)) salidas.set(a.desde, [])
    if (!entradas.has(a.hacia)) entradas.set(a.hacia, [])
    salidas.get(a.desde).push(a); entradas.get(a.hacia).push(a)
  }
  const nombreDe = (id) => esc(porId.get(id)?.it.dato.etiqueta ?? id)
  const detalle = items.map((it, k) => {
    const d = it.dato
    const prop = d.estado === 'propuesta' ? '<span class="chip">PROPUESTA</span>' : ''
    const conex = [
      ...(entradas.get(it.id) ?? []).map((a) => `<li>← desde <b>${nombreDe(a.desde)}</b>${a.etiqueta ? ` (${esc(a.etiqueta)})` : ''}</li>`),
      ...(salidas.get(it.id) ?? []).map((a) => `<li>→ hacia <b>${nombreDe(a.hacia)}</b>${a.etiqueta ? ` (${esc(a.etiqueta)})` : ''}</li>`),
    ].join('')
    if (esDatos) {
      const campos = (d.campos ?? []).map((f) => `<tr><td>${f.pk ? '<b>PK</b> ' : f.fk ? '<b>FK</b> ' : ''}${esc(f.nombre)}</td><td>${esc(f.tipo ?? '')}</td><td>${f.fk ? `→ ${esc(f.fk)}` : ''}${f.nota ? ` ${esc(f.nota)}` : ''}</td></tr>`).join('')
      return `<details id="d-${esc(it.id)}"><summary>${esc(d.nombre)}${prop}</summary>${d.descripcion ? `<p>${esc(d.descripcion)}</p>` : ''}${d.ref ? `<p><code>${esc(d.ref)}</code></p>` : ''}<table class="campos">${campos}</table>${conex ? `<ul>${conex}</ul>` : ''}</details>`
    }
    return `<details id="d-${esc(it.id)}"><summary><span class="n">${k + 1}.</span>${esc(d.etiqueta ?? d.id)}${d.grupo ? ` <span class="n">· ${esc(d.grupo)}</span>` : ''}${prop}</summary>${d.detalle ? `<p>${esc(d.detalle)}</p>` : ''}${d.ref ? `<p><code>${esc(d.ref)}</code></p>` : ''}${conex ? `<ul>${conex}</ul>` : ''}</details>`
  }).join('')

  const notas = (plano.notas ?? []).filter(Boolean)
  const fechaTxt = fecha.toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })
  const resumen = esDatos ? `${items.length} tablas · ${aristas.length} relaciones` : `${items.length} elementos · ${aristas.length} conexiones`
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="dsh-planos">
<title>${esc(plano.titulo)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
<div class="tipo">${esc(TIPOS[plano.tipo])}</div>
<h1>${esc(plano.titulo)}</h1>
${plano.descripcion ? `<p class="desc">${esc(plano.descripcion)}</p>` : ''}
<div class="meta">${resumen}${plano.fuente ? ` · Basado en: ${esc(plano.fuente)}` : ''} · ${esc(fechaTxt)}</div>
</header>
<div class="lienzo">
<div class="controles"><button id="zoom" type="button">Tamaño real</button></div>
<div class="marco">${svg}</div>
<div class="leyenda">${leyenda}</div>
</div>
<section>
<h2>${esDatos ? 'Tablas' : 'Detalle de cada paso'}</h2>
${detalle}
</section>
${notas.length ? `<section class="notas"><h2>Notas y pendientes</h2><ul>${notas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
<footer>Generado con dsh-planos. Toca un elemento del diagrama para ver sus conexiones.</footer>
<script>${JS}</script>
</body>
</html>
`
}
