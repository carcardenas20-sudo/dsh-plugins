// Kit visual y motor de los artefactos de dsh-artefactos.
// Todo va dentro de cada HTML (sin internet). El motor dibuja la página a partir
// de la especificación (JSON) que escribe el agente y guarda lo que el usuario
// ingresa: en el proyecto (si se abre desde el servidor local del plugin) o en el
// navegador como respaldo.

export const CSS = String.raw`
:root{--acento:#2d6cdf;--acento-suave:color-mix(in srgb,var(--acento) 12%,transparent);--bg:#f5f6f8;--panel:#fff;--panel-2:#f9fafb;--tinta:#18202c;--suave:#5b6676;--tenue:#8a94a3;--borde:#e3e7ee;--borde-2:#d3d9e2;--ok:#1f8f55;--mal:#c2413a;--aviso:#b7791f;--sombra:0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.06);--radio:12px}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--panel:#171b21;--panel-2:#1c2128;--tinta:#e8ecf2;--suave:#a2acba;--tenue:#7c8696;--borde:#2a313b;--borde-2:#36404c;--sombra:none;--acento-suave:color-mix(in srgb,var(--acento) 22%,transparent)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--tinta);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.cab{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid var(--borde)}
.cab-in{max-width:1120px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.marca{width:34px;height:34px;border-radius:9px;background:var(--acento);display:grid;place-items:center;color:#fff;font-weight:800;font-size:15px;flex:none}
.cab h1{font-size:18px;line-height:1.2;margin:0;font-weight:700;letter-spacing:-.01em}
.cab .sub{font-size:13px;color:var(--suave);margin:2px 0 0}
.cab .esp{flex:1}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--suave);background:var(--panel);border:1px solid var(--borde);border-radius:999px;padding:4px 10px;white-space:nowrap}
.chip i{width:8px;height:8px;border-radius:50%;background:var(--tenue);display:inline-block}
.chip.ok i{background:var(--ok)}.chip.local i{background:var(--aviso)}.chip.mal i{background:var(--mal)}
.btn{font:inherit;font-size:13.5px;font-weight:600;border:1px solid var(--borde-2);background:var(--panel);color:var(--tinta);border-radius:9px;padding:7px 12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background .15s,border-color .15s}
.btn:hover{border-color:var(--acento)}
.btn.prim{background:var(--acento);border-color:var(--acento);color:#fff}
.btn.prim:hover{filter:brightness(1.07)}
.btn.chico{padding:4px 9px;font-size:12.5px}
.btn.fantasma{border-color:transparent;background:transparent;color:var(--suave)}
.btn.fantasma:hover{color:var(--mal);border-color:transparent}
main{max-width:1120px;margin:0 auto;padding:22px 20px 60px}
.intro{color:var(--suave);margin:0 0 18px;max-width:80ch}
.seccion{margin:0 0 26px}
.seccion>h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--suave);margin:0 0 4px;font-weight:700}
.seccion>.desc{color:var(--suave);font-size:14px;margin:0 0 12px}
.rejilla{display:grid;gap:14px;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr))}
@media (max-width:760px){.rejilla{grid-template-columns:1fr}}
.tarjeta{background:var(--panel);border:1px solid var(--borde);border-radius:var(--radio);box-shadow:var(--sombra);padding:16px 18px;min-width:0}
.tarjeta>h3{font-size:15px;margin:0 0 10px;font-weight:700}
.tarjeta>.desc{color:var(--suave);font-size:13.5px;margin:-6px 0 12px}
.prosa p{margin:0 0 10px}.prosa ul,.prosa ol{margin:0 0 10px;padding-left:20px}.prosa h4{margin:12px 0 6px;font-size:14.5px}
.prosa code{font-family:ui-monospace,Consolas,monospace;font-size:13px;background:var(--panel-2);border:1px solid var(--borde);border-radius:5px;padding:1px 5px}
.kpis{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
@media (max-width:420px){.kpi .va{font-size:21px}.kpis{grid-template-columns:1fr 1fr}}
.kpi{background:var(--panel);border:1px solid var(--borde);border-radius:var(--radio);box-shadow:var(--sombra);padding:14px 16px}
.kpi .et{font-size:12.5px;color:var(--suave);font-weight:600}
.kpi .va{font-size:26px;font-weight:750;letter-spacing:-.02em;margin-top:2px;font-variant-numeric:tabular-nums}
.kpi .no{font-size:12.5px;color:var(--tenue);margin-top:2px}
.kpi.acento{border-top:3px solid var(--acento)}
form.f{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}
@media (max-width:560px){form.f{grid-template-columns:1fr}}
.campo{display:flex;flex-direction:column;gap:5px;min-width:0}
.campo.ancho{grid-column:1/-1}
.campo label{font-size:13px;font-weight:600;color:var(--suave)}
.campo label b{color:var(--mal);font-weight:700}
input,select,textarea{font:inherit;font-size:14.5px;color:var(--tinta);background:var(--panel-2);border:1px solid var(--borde-2);border-radius:9px;padding:8px 10px;width:100%;min-width:0}
input:focus,select:focus,textarea:focus{outline:2px solid var(--acento-suave);border-color:var(--acento)}
textarea{resize:vertical;min-height:80px}
.acciones{grid-column:1/-1;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.aviso{font-size:13px;color:var(--mal)}
.envoltura{overflow-x:auto;margin:0 -2px;-webkit-overflow-scrolling:touch}
table.t{width:100%;border-collapse:separate;border-spacing:0;font-size:14px}
table.t th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--suave);font-weight:700;padding:8px 10px;border-bottom:1px solid var(--borde-2);white-space:nowrap;background:var(--panel)}
table.t td{padding:7px 10px;border-bottom:1px solid var(--borde);vertical-align:middle}
table.t tr:hover td{background:var(--panel-2)}
table.t td.num,table.t th.num{text-align:right;font-variant-numeric:tabular-nums}
table.t tfoot td{font-weight:700;border-top:1px solid var(--borde-2);border-bottom:none}
table.t td input,table.t td select{padding:5px 7px;font-size:14px;background:transparent;border-color:transparent}
table.t td input:hover,table.t td select:hover{border-color:var(--borde-2)}
table.t td input:focus{background:var(--panel-2)}
.vacio{color:var(--tenue);font-size:13.5px;padding:14px 4px;text-align:center}
.barra-tabla{display:flex;gap:8px;align-items:center;margin:0 0 10px;flex-wrap:wrap}
.barra-tabla input{max-width:240px}
.lista{list-style:none;margin:0;padding:0}
.lista li{display:flex;align-items:center;gap:10px;padding:7px 2px;border-bottom:1px solid var(--borde)}
.lista li:last-child{border-bottom:none}
.lista input[type=checkbox]{width:18px;height:18px;accent-color:var(--acento);flex:none}
.lista li.hecho span{color:var(--tenue);text-decoration:line-through}
.lista li span{flex:1;min-width:0}
.progreso{height:6px;background:var(--panel-2);border-radius:99px;overflow:hidden;margin:0 0 10px;border:1px solid var(--borde)}
.progreso>div{height:100%;background:var(--acento);transition:width .3s}
.nueva{display:flex;gap:8px;margin-top:10px}
.calc{display:grid;gap:14px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
@media (max-width:560px){.calc{grid-template-columns:1fr}}
.resultados{display:flex;flex-direction:column;gap:8px}
.res{display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:9px 12px;border-radius:9px;background:var(--panel-2);border:1px solid var(--borde)}
.res .et{color:var(--suave);font-size:13.5px}
.res .va{font-weight:750;font-size:17px;font-variant-numeric:tabular-nums}
.res.destacado{background:var(--acento-suave);border-color:var(--acento)}
.res.destacado .va{font-size:21px}
svg.graf{width:100%;height:auto;display:block}
svg.graf text{fill:var(--suave);font-size:11px;font-family:inherit}
svg.graf .eje{stroke:var(--borde-2)}
svg.graf .guia{stroke:var(--borde);stroke-dasharray:3 3}
.leyenda{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;color:var(--suave);margin-top:8px}
.leyenda span{display:inline-flex;align-items:center;gap:6px}
.leyenda i{width:10px;height:10px;border-radius:3px;display:inline-block}
.pie{max-width:1120px;margin:0 auto;padding:0 20px 30px;color:var(--tenue);font-size:12px}
.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--tinta);color:var(--bg);padding:9px 14px;border-radius:10px;font-size:13.5px;opacity:0;transition:.25s;pointer-events:none;z-index:20}
.toast.ver{opacity:1;transform:translateX(-50%)}
.error-espec{background:#fdecec;color:#7a1f1a;border:1px solid #f3c2bf;border-radius:10px;padding:12px 14px;font-size:14px}
@media print{.cab{position:static;backdrop-filter:none}.no-imprimir,.btn,.nueva,.barra-tabla{display:none!important}body{background:#fff}.tarjeta,.kpi{box-shadow:none}}
`

// Motor del lado del navegador. Lee window.__ESPEC__ y window.__CONEXION__.
export const RUNTIME = String.raw`
(function(){
"use strict";
var E = window.__ESPEC__ || {}; var C = window.__CONEXION__ || null;
var D = { version: 1, registros: {}, tablas: {}, listas: {}, notas: {}, calculos: {}, actualizado: null };
var raiz = document.getElementById('app');
var guardarT = null, modo = 'local';
var LS = 'dsh-artefacto:' + (E.nombre || 'sin-nombre');

// ---------- utilidades ----------
function h(tag, attrs, hijos){ var el = document.createElement(tag); if (attrs) for (var k in attrs){ var v = attrs[k]; if (v == null || v === false) continue; if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k === 'html') el.innerHTML = v; else if (k.slice(0,2) === 'on') el.addEventListener(k.slice(2), v); else if (k === 'style') el.style.cssText = v; else el.setAttribute(k, v === true ? '' : v) } (hijos || []).forEach(function(c){ if (c == null) return; el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c) }); return el }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] }) }
function num(v){ if (typeof v === 'number') return v; if (v == null || v === '') return 0; var t = String(v).replace(/[$\s]/g,''); if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g,''); t = t.replace(',', '.'); var n = parseFloat(t); return isNaN(n) ? 0 : n }
var LOC = E.locale || 'es-CO', MON = E.moneda || 'COP';
function fmt(v, f){ if (v == null || v === '') return '—'; if (typeof v === 'string' && f !== 'dinero' && f !== 'numero' && f !== 'porcentaje') return v; var n = num(v);
  try { if (f === 'dinero') return new Intl.NumberFormat(LOC, { style: 'currency', currency: MON, maximumFractionDigits: MON === 'COP' ? 0 : 2 }).format(n);
  if (f === 'porcentaje') return new Intl.NumberFormat(LOC, { maximumFractionDigits: 1 }).format(n) + '%';
  if (f === 'decimal') return new Intl.NumberFormat(LOC, { maximumFractionDigits: 2 }).format(n);
  if (f === 'fecha') { var d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString(LOC) }
  return new Intl.NumberFormat(LOC, { maximumFractionDigits: 2 }).format(n) } catch (e) { return String(v) } }
function md(t){ var s = esc(t || ''); s = s.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g,'$1<i>$2</i>').replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>');
  var out = [], lista = null; s.split(/\n/).forEach(function(l){ var m = l.match(/^\s*[-*]\s+(.*)/), o = l.match(/^\s*\d+[.)]\s+(.*)/), hh = l.match(/^#{1,4}\s+(.*)/);
    if (m || o){ var tipo = m ? 'ul' : 'ol'; if (!lista || lista.t !== tipo){ if (lista) out.push('</'+lista.t+'>'); lista = { t: tipo }; out.push('<'+tipo+'>') } out.push('<li>' + (m||o)[1] + '</li>'); return }
    if (lista){ out.push('</'+lista.t+'>'); lista = null }
    if (hh) out.push('<h4>' + hh[1] + '</h4>'); else if (l.trim()) out.push('<p>' + l + '</p>') });
  if (lista) out.push('</'+lista.t+'>'); return out.join('') }
function toast(t){ var el = document.querySelector('.toast'); if (!el){ el = h('div', { class: 'toast' }); document.body.appendChild(el) } el.textContent = t; el.classList.add('ver'); clearTimeout(el._t); el._t = setTimeout(function(){ el.classList.remove('ver') }, 2200) }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }

// ---------- fórmulas seguras (sin eval) ----------
// Números, + - * / % ( ), comparaciones, variables (a, a.b) y funciones:
// suma, promedio, contar, min, max, redondear, si, abs.
function formula(expr, ctx){
  var s = String(expr), i = 0;
  function sp(){ while (i < s.length && /\s/.test(s[i])) i++ }
  function expr0(){ var a = cmp(); return a }
  function cmp(){ var a = add(); sp(); var m = s.slice(i).match(/^(>=|<=|==|!=|>|<)/); if (m){ i += m[1].length; var b = add(); switch (m[1]) { case '>': return +(a > b); case '<': return +(a < b); case '>=': return +(a >= b); case '<=': return +(a <= b); case '==': return +(a == b); default: return +(a != b) } } return a }
  function add(){ var a = mul(); for (;;){ sp(); var c = s[i]; if (c === '+' || c === '-'){ i++; var b = mul(); a = c === '+' ? esc0(a) + esc0(b) : esc0(a) - esc0(b) } else return a } }
  function mul(){ var a = un(); for (;;){ sp(); var c = s[i]; if (c === '*' || c === '/' || c === '%'){ i++; var b = un(); a = c === '*' ? esc0(a) * esc0(b) : c === '/' ? (esc0(b) === 0 ? 0 : esc0(a) / esc0(b)) : esc0(a) % esc0(b) } else return a } }
  function un(){ sp(); if (s[i] === '-'){ i++; return -esc0(un()) } if (s[i] === '+'){ i++; return un() } return at() }
  function esc0(v){ return Array.isArray(v) ? v.reduce(function(x, y){ return x + num(y) }, 0) : num(v) }
  function at(){ sp(); var c = s[i];
    if (c === '('){ i++; var v = expr0(); sp(); i++; return v }
    var m = s.slice(i).match(/^\d+(\.\d+)?/); if (m){ i += m[0].length; return parseFloat(m[0]) }
    m = s.slice(i).match(/^[A-Za-z_À-ſ][\wÀ-ſ]*(\.[A-Za-z_À-ſ][\wÀ-ſ]*)?/);
    if (m){ i += m[0].length; sp(); var nombre = m[0];
      if (s[i] === '('){ i++; var args = []; sp(); if (s[i] !== ')'){ for (;;){ args.push(expr0()); sp(); if (s[i] === ','){ i++; continue } break } } sp(); i++; return fn(nombre.toLowerCase(), args) }
      return ctx(nombre) }
    throw new Error('fórmula inválida cerca de: ' + s.slice(i, i + 10)) }
  function arr(v){ return Array.isArray(v) ? v : [v] }
  function fn(n, a){ var xs;
    switch (n) {
      case 'suma': return arr(a[0]).reduce(function(x, y){ return x + num(y) }, 0);
      case 'contar': return Array.isArray(a[0]) ? a[0].filter(function(x){ return x !== '' && x != null }).length : (a[0] ? 1 : 0);
      case 'promedio': xs = arr(a[0]).map(num); return xs.length ? xs.reduce(function(x, y){ return x + y }, 0) / xs.length : 0;
      case 'min': xs = a.length > 1 ? a.map(num) : arr(a[0]).map(num); return xs.length ? Math.min.apply(null, xs) : 0;
      case 'max': xs = a.length > 1 ? a.map(num) : arr(a[0]).map(num); return xs.length ? Math.max.apply(null, xs) : 0;
      case 'redondear': var p = Math.pow(10, num(a[1] || 0)); return Math.round(num(a[0]) * p) / p;
      case 'abs': return Math.abs(num(a[0]));
      case 'si': return num(a[0]) ? a[1] : a[2];
      default: throw new Error('función desconocida: ' + n) } }
  var r = expr0(); sp(); if (i < s.length) throw new Error('sobra texto en la fórmula: ' + s.slice(i)); return r }

// Variables: "coleccion" (filas), "coleccion.campo" (columna), entradas de calculadoras por id.
function contexto(extra){ return function(nombre){
  if (extra && Object.prototype.hasOwnProperty.call(extra, nombre)) return extra[nombre];
  var p = nombre.split('.'), base = p[0], campo = p[1];
  var filas = D.registros[base] || D.tablas[base] || (D.listas[base] ? D.listas[base].map(function(x){ return { texto: x.texto, hecho: x.hecho ? 1 : 0 } }) : null);
  if (filas){ return campo ? filas.map(function(f){ return f[campo] }) : filas.map(function(){ return 1 }) }
  for (var k in D.calculos){ if (D.calculos[k] && Object.prototype.hasOwnProperty.call(D.calculos[k], nombre)) return num(D.calculos[k][nombre]) }
  return 0 } }
function evaluar(expr, extra){ try { return formula(expr, contexto(extra)) } catch (e) { return '⚠ ' + e.message } }

// ---------- datos: servidor del proyecto o navegador ----------
function guardar(inmediato){ D.actualizado = new Date().toISOString(); refrescarDerivados(); clearTimeout(guardarT); guardarT = setTimeout(enviar, inmediato ? 0 : 450) }
function enviar(){
  if (modo === 'proyecto' && C){ estado('guardando'); fetch(C.datos, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(D) })
      .then(function(r){ if (!r.ok) throw new Error(r.status); estado('ok') }).catch(function(){ estado('mal'); try { localStorage.setItem(LS, JSON.stringify(D)) } catch (e) {} }); return }
  try { localStorage.setItem(LS, JSON.stringify(D)); estado('local') } catch (e) { estado('sin') } }
function estado(e){ var ch = document.getElementById('estado'); if (!ch) return;
  var t = { ok: ['ok', 'Guardado en el proyecto'], guardando: ['', 'Guardando…'], mal: ['mal', 'No se pudo guardar en el proyecto'], local: ['local', 'Guardado solo en este navegador'], sin: ['mal', 'Sin guardado: exporta los datos'] }[e];
  ch.className = 'chip ' + t[0]; ch.lastChild.textContent = t[1] }
function mezclar(base, d){ if (!d || typeof d !== 'object') return base; ['registros','tablas','listas','notas','calculos'].forEach(function(k){ if (d[k] && typeof d[k] === 'object') base[k] = d[k] }); base.actualizado = d.actualizado || null; return base }
function cargar(listo){
  var ini = E.datosIniciales ? JSON.parse(JSON.stringify(E.datosIniciales)) : null;
  if (ini) mezclar(D, ini);
  if (C && location.protocol.indexOf('http') === 0){
    fetch(C.datos, { cache: 'no-store' }).then(function(r){ if (r.status === 404) return null; if (!r.ok) throw new Error(r.status); return r.json() })
      .then(function(d){ modo = 'proyecto'; if (d) mezclar(D, d); estado('ok'); listo() })
      .catch(function(){ modo = 'local'; desdeNavegador(); estado('local'); listo() });
    return }
  desdeNavegador(); estado(modo === 'local' ? 'local' : 'sin'); listo() }
function desdeNavegador(){ try { var t = localStorage.getItem(LS); if (t) mezclar(D, JSON.parse(t)) } catch (e) { modo = 'sin' } }

// ---------- bloques ----------
var derivados = [];
function refrescarDerivados(){ derivados.forEach(function(f){ try { f() } catch (e) {} }) }

var B = {};
B.texto = function(b){ return h('div', { class: 'prosa', html: md(b.contenido || b.texto || '') }) };

B.kpis = function(b){ var cont = h('div', { class: 'kpis' });
  (b.items || []).forEach(function(k, n){ var va = h('div', { class: 'va' }); var el = h('div', { class: 'kpi' + (n === 0 && b.destacarPrimero !== false ? ' acento' : '') }, [h('div', { class: 'et', text: k.etiqueta }), va, k.nota ? h('div', { class: 'no', text: k.nota }) : null]);
    var pintar = function(){ va.textContent = fmt(k.formula ? evaluar(k.formula) : k.valor, k.formato) }; pintar(); derivados.push(pintar); cont.appendChild(el) });
  return cont };

function control(c, valor, onCambio){ var t = c.tipo || 'texto', el;
  if (t === 'seleccion'){ el = h('select', { id: c._id, required: c.requerido }); el.appendChild(h('option', { value: '', text: c.placeholder || 'Elegir…' })); (c.opciones || []).forEach(function(o){ el.appendChild(h('option', { value: o, text: o })) }) }
  else if (t === 'area') el = h('textarea', { id: c._id, required: c.requerido, placeholder: c.placeholder || '' });
  else if (t === 'si_no'){ el = h('select', { id: c._id }); ['', 'Sí', 'No'].forEach(function(o){ el.appendChild(h('option', { value: o, text: o || 'Elegir…' })) }) }
  else { var tipoHtml = { numero: 'number', dinero: 'text', porcentaje: 'number', fecha: 'date', email: 'email', telefono: 'tel', hora: 'time' }[t] || 'text';
    el = h('input', { id: c._id, type: tipoHtml, required: c.requerido, placeholder: c.placeholder || (t === 'dinero' ? '$ 0' : ''), step: t === 'numero' || t === 'porcentaje' ? 'any' : null, inputmode: t === 'dinero' ? 'decimal' : null, min: c.min, max: c.max }) }
  if (valor != null) el.value = valor;
  if (onCambio) el.addEventListener('input', function(){ onCambio(el.value) });
  return el }
function valorDe(c, v){ var t = c.tipo || 'texto'; return t === 'numero' || t === 'dinero' || t === 'porcentaje' ? (v === '' ? '' : num(v)) : v }
function formatoCampo(c){ return { dinero: 'dinero', numero: 'numero', porcentaje: 'porcentaje', fecha: 'fecha' }[c.tipo] }

B.formulario = function(b){
  var id = b.id, campos = b.campos || []; D.registros[id] = D.registros[id] || [];
  var form = h('form', { class: 'f', novalidate: true }); var editando = null; var aviso = h('span', { class: 'aviso' });
  campos.forEach(function(c){ c._id = 'f-' + id + '-' + c.id; form.appendChild(h('div', { class: 'campo' + (c.tipo === 'area' || c.ancho ? ' ancho' : '') }, [h('label', { for: c._id }, [c.etiqueta || c.id, c.requerido ? h('b', { text: ' *' }) : null]), control(c)])) });
  var btn = h('button', { class: 'btn prim', type: 'submit', text: b.boton || 'Guardar' }); var cancelar = h('button', { class: 'btn', type: 'button', text: 'Cancelar', style: 'display:none' });
  form.appendChild(h('div', { class: 'acciones' }, [btn, cancelar, aviso]));
  function limpiar(){ form.reset(); editando = null; btn.textContent = b.boton || 'Guardar'; cancelar.style.display = 'none'; aviso.textContent = '' }
  cancelar.addEventListener('click', limpiar);
  form.addEventListener('submit', function(ev){ ev.preventDefault(); var fila = {}, faltan = [];
    campos.forEach(function(c){ var v = document.getElementById(c._id).value.trim(); if (c.requerido && !v) faltan.push(c.etiqueta || c.id); fila[c.id] = valorDe(c, v) });
    if (faltan.length){ aviso.textContent = 'Falta: ' + faltan.join(', '); return }
    if (editando){ var i = D.registros[id].findIndex(function(r){ return r._id === editando }); if (i >= 0){ fila._id = editando; fila._fecha = D.registros[id][i]._fecha; D.registros[id][i] = fila } toast('Actualizado') }
    else { fila._id = uid(); fila._fecha = new Date().toISOString(); D.registros[id].push(fila); toast(b.mensaje || 'Guardado') }
    limpiar(); guardar(true); pintar() });
  var mostrar = b.mostrarRegistros !== false; var buscar = h('input', { type: 'search', placeholder: 'Buscar…' }); var tablaCont = h('div', { class: 'envoltura' }); var cuenta = h('span', { class: 'chip' });
  function pintar(){ if (!mostrar) return; var q = (buscar.value || '').toLowerCase(); var filas = D.registros[id].filter(function(r){ return !q || JSON.stringify(r).toLowerCase().indexOf(q) >= 0 });
    cuenta.textContent = D.registros[id].length + ' registro' + (D.registros[id].length === 1 ? '' : 's'); tablaCont.innerHTML = '';
    if (!filas.length){ tablaCont.appendChild(h('div', { class: 'vacio', text: D.registros[id].length ? 'Nada coincide con la búsqueda.' : (b.vacio || 'Todavía no hay registros.') })); return }
    var thead = h('tr', null, campos.filter(function(c){ return c.enTabla !== false }).map(function(c){ return h('th', { class: formatoCampo(c) && c.tipo !== 'fecha' ? 'num' : null, text: c.etiqueta || c.id }) }).concat([h('th', { text: '' })]));
    var tb = h('tbody'); filas.slice().reverse().forEach(function(r){ tb.appendChild(h('tr', null, campos.filter(function(c){ return c.enTabla !== false }).map(function(c){ return h('td', { class: formatoCampo(c) && c.tipo !== 'fecha' ? 'num' : null, text: fmt(r[c.id], formatoCampo(c)) }) }).concat([h('td', { style: 'white-space:nowrap;text-align:right' }, [
      h('button', { class: 'btn chico', type: 'button', text: 'Editar', onclick: function(){ editando = r._id; campos.forEach(function(c){ document.getElementById(c._id).value = r[c.id] == null ? '' : r[c.id] }); btn.textContent = 'Actualizar'; cancelar.style.display = ''; form.scrollIntoView({ behavior: 'smooth', block: 'center' }) } }),
      h('button', { class: 'btn chico fantasma', type: 'button', text: 'Borrar', onclick: function(){ if (!confirm('¿Borrar este registro?')) return; D.registros[id] = D.registros[id].filter(function(x){ return x._id !== r._id }); guardar(true); pintar() } })])]))) });
    var tf = null; var sumables = campos.filter(function(c){ return c.enTabla !== false });
    if (sumables.some(function(c){ return c.tipo === 'dinero' || (c.tipo === 'numero' && c.total) })){ tf = h('tfoot', null, [h('tr', null, sumables.map(function(c, k){ var s = (c.tipo === 'dinero' || (c.tipo === 'numero' && c.total)) ? fmt(filas.reduce(function(a, r){ return a + num(r[c.id]) }, 0), formatoCampo(c)) : (k === 0 ? 'Total' : ''); return h('td', { class: formatoCampo(c) && c.tipo !== 'fecha' ? 'num' : null, text: s }) }).concat([h('td')]))]) }
    tablaCont.appendChild(h('table', { class: 't' }, [h('thead', null, [thead]), tb, tf])) }
  buscar.addEventListener('input', pintar); derivados.push(pintar); pintar();
  return h('div', null, [form, mostrar ? h('div', { style: 'margin-top:18px' }, [h('div', { class: 'barra-tabla' }, [buscar, cuenta]), tablaCont]) : null]) };

B.tabla = function(b){
  var id = b.id, cols = b.columnas || [];
  if (!D.tablas[id]) D.tablas[id] = (b.filas || []).map(function(f){ var o = Array.isArray(f) ? {} : Object.assign({}, f); if (Array.isArray(f)) cols.forEach(function(c, k){ o[c.id] = f[k] }); return o });
  var cont = h('div', { class: 'envoltura' });
  function calcFila(f){ cols.forEach(function(c){ if (c.formula) f[c.id] = evaluar(c.formula, f) }) }
  function pintar(){ cont.innerHTML = ''; var filas = D.tablas[id]; filas.forEach(calcFila);
    var thead = h('tr', null, cols.map(function(c){ return h('th', { class: formatoCampo(c) && c.tipo !== 'fecha' ? 'num' : null, text: c.etiqueta || c.id }) }).concat(b.editable !== false ? [h('th')] : []));
    var tb = h('tbody'); filas.forEach(function(f, n){ tb.appendChild(h('tr', null, cols.map(function(c){
      if (c.formula || b.editable === false) return h('td', { class: formatoCampo(c) && c.tipo !== 'fecha' ? 'num' : null, text: fmt(f[c.id], formatoCampo(c) || (c.formula ? 'numero' : null)) });
      var cc = Object.assign({}, c, { _id: null }); var inp = control(cc, f[c.id], function(v){ f[c.id] = valorDe(c, v); guardar(); pintarTotales() }); inp.addEventListener('change', function(){ pintar() }); if (formatoCampo(c) && c.tipo !== 'fecha') inp.style.textAlign = 'right'; return h('td', null, [inp]) })
      .concat(b.editable !== false ? [h('td', { style: 'text-align:right' }, [h('button', { class: 'btn chico fantasma', type: 'button', text: '✕', title: 'Quitar fila', onclick: function(){ filas.splice(n, 1); guardar(true); pintar() } })])] : []))) });
    var tf = h('tfoot'); cont.appendChild(h('table', { class: 't' }, [h('thead', null, [thead]), tb, tf])); cont._tf = tf; pintarTotales();
    if (!filas.length) cont.appendChild(h('div', { class: 'vacio', text: 'Sin filas todavía.' })) }
  function pintarTotales(){ var tf = cont._tf; if (!tf) return; var filas = D.tablas[id]; filas.forEach(calcFila); tf.innerHTML = '';
    if (!cols.some(function(c){ return c.total })) return;
    tf.appendChild(h('tr', null, cols.map(function(c, k){ return h('td', { class: formatoCampo(c) || c.formula ? 'num' : null, text: c.total ? fmt(filas.reduce(function(a, f){ return a + num(f[c.id]) }, 0), formatoCampo(c) || 'numero') : (k === 0 ? 'Total' : '') }) }).concat(b.editable !== false ? [h('td')] : [])));
    // celdas calculadas visibles
    var trs = cont.querySelectorAll('tbody tr'); filas.forEach(function(f, n){ var tds = trs[n] && trs[n].children; if (!tds) return; cols.forEach(function(c, k){ if (c.formula && tds[k]) tds[k].textContent = fmt(f[c.id], formatoCampo(c) || 'numero') }) }); refrescarDerivados() }
  var bar = b.editable !== false ? h('div', { class: 'nueva' }, [h('button', { class: 'btn chico', type: 'button', text: '+ Agregar fila', onclick: function(){ var f = {}; cols.forEach(function(c){ f[c.id] = '' }); D.tablas[id].push(f); guardar(true); pintar() } })]) : null;
  pintar(); return h('div', null, [cont, bar]) };

B.lista = function(b){
  var id = b.id; if (!D.listas[id]) D.listas[id] = (b.items || []).map(function(t){ return { texto: typeof t === 'string' ? t : t.texto, hecho: !!(t && t.hecho) } });
  var ul = h('ul', { class: 'lista' }); var barra = h('div', { class: 'progreso' }, [h('div')]); var cuenta = h('div', { class: 'desc', style: 'font-size:13px;color:var(--suave);margin:0 0 6px' });
  function pintar(){ var it = D.listas[id]; ul.innerHTML = ''; var hechos = it.filter(function(x){ return x.hecho }).length; barra.firstChild.style.width = (it.length ? hechos / it.length * 100 : 0) + '%'; cuenta.textContent = hechos + ' de ' + it.length + ' hechas';
    it.forEach(function(x, n){ var cb = h('input', { type: 'checkbox' }); cb.checked = x.hecho; cb.addEventListener('change', function(){ x.hecho = cb.checked; guardar(true); pintar() });
      ul.appendChild(h('li', { class: x.hecho ? 'hecho' : '' }, [cb, h('span', { text: x.texto }), b.editable !== false ? h('button', { class: 'btn chico fantasma', type: 'button', text: '✕', onclick: function(){ it.splice(n, 1); guardar(true); pintar() } }) : null])) }) }
  var nueva = null; if (b.editable !== false){ var inp = h('input', { placeholder: b.placeholder || 'Agregar…' }); var add = function(){ var t = inp.value.trim(); if (!t) return; D.listas[id].push({ texto: t, hecho: false }); inp.value = ''; guardar(true); pintar() };
    inp.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); add() } }); nueva = h('div', { class: 'nueva' }, [inp, h('button', { class: 'btn', type: 'button', text: 'Agregar', onclick: add })]) }
  pintar(); return h('div', null, [cuenta, barra, ul, nueva]) };

B.notas = function(b){ var id = b.id; var ta = h('textarea', { placeholder: b.placeholder || 'Escribe aquí…', style: 'min-height:' + (b.alto || 140) + 'px' }); ta.value = D.notas[id] != null ? D.notas[id] : (b.texto || '');
  ta.addEventListener('input', function(){ D.notas[id] = ta.value; guardar() }); return ta };

B.calculadora = function(b){
  var id = b.id; D.calculos[id] = D.calculos[id] || {}; var vals = D.calculos[id];
  (b.entradas || []).forEach(function(e){ if (vals[e.id] == null && e.valor != null) vals[e.id] = e.valor });
  var izq = h('div', { class: 'f', style: 'display:grid;gap:10px' }); var der = h('div', { class: 'resultados' }); var res = [];
  (b.entradas || []).forEach(function(e){ e._id = 'c-' + id + '-' + e.id; izq.appendChild(h('div', { class: 'campo' }, [h('label', { for: e._id, text: e.etiqueta || e.id }), control(e, vals[e.id], function(v){ vals[e.id] = valorDe(e, v); guardar(); calcular() })])) });
  (b.resultados || []).forEach(function(r, n){ var va = h('span', { class: 'va' }); der.appendChild(h('div', { class: 'res' + (r.destacado || (n === (b.resultados.length - 1) && b.destacarUltimo !== false) ? ' destacado' : '') }, [h('span', { class: 'et', text: r.etiqueta }), va])); res.push([r, va]) });
  function calcular(){ var ctx = {}; (b.entradas || []).forEach(function(e){ ctx[e.id] = num(vals[e.id]) });
    res.forEach(function(p){ var v = evaluar(p[0].formula, ctx); if (p[0].id) ctx[p[0].id] = v; p[1].textContent = fmt(v, p[0].formato || 'numero') }); refrescarDerivados() }
  calcular(); return h('div', { class: 'calc' }, [izq, der]) };

function corto(v, f){ try { var s = new Intl.NumberFormat(LOC, { notation: 'compact', maximumFractionDigits: 1 }).format(v); return f === 'dinero' ? '$' + s : f === 'porcentaje' ? s + '%' : s } catch (e) { return String(Math.round(v)) } }
var PALETA = ['var(--acento)', '#2a9d8f', '#7a5cc4', '#d1495b', '#3b7ea1', '#4f8a2b', '#c06c2b', '#8a94a3'];
function serieDe(b){
  if (b.fuente){ var f = b.fuente; var filas = D.registros[f.de] || D.tablas[f.de] || []; var grupos = {}, orden = [];
    filas.forEach(function(r){ var k = f.x ? String(r[f.x] == null || r[f.x] === '' ? '(vacío)' : r[f.x]) : 'Total'; if (!(k in grupos)){ grupos[k] = []; orden.push(k) } grupos[k].push(f.y ? num(r[f.y]) : 1) });
    var ag = f.agregacion || (f.y ? 'suma' : 'contar');
    var out = orden.map(function(k){ var xs = grupos[k]; var v = ag === 'contar' ? xs.length : ag === 'promedio' ? xs.reduce(function(a, x){ return a + x }, 0) / xs.length : xs.reduce(function(a, x){ return a + x }, 0); return { etiqueta: k, valor: v } });
    if (f.ordenar === 'valor') out.sort(function(a, b){ return b.valor - a.valor }); if (f.max) out = out.slice(0, f.max); return out }
  return (b.datos || []).map(function(d){ return { etiqueta: d.etiqueta, valor: d.formula ? num(evaluar(d.formula)) : num(d.valor) } }) }
B.grafico = function(b){ var cont = h('div'); function pintar(){ var d = serieDe(b); cont.innerHTML = ''; if (!d.length){ cont.appendChild(h('div', { class: 'vacio', text: b.vacio || 'Sin datos para graficar todavía.' })); return }
  var tipo = b.tipoGrafico || b.forma || 'barras', f = b.formato, svg;
  if (tipo === 'torta'){ var tot = d.reduce(function(a, x){ return a + Math.max(0, x.valor) }, 0) || 1, ang = -Math.PI / 2, R = 80, r0 = 50, paths = '';
    d.forEach(function(x, k){ var a2 = ang + Math.max(0, x.valor) / tot * Math.PI * 2; var g = a2 - ang >= Math.PI * 2 - 1e-6; if (g) a2 -= 1e-4; var l = a2 - ang > Math.PI ? 1 : 0;
      var p = function(a, rr){ return (100 + rr * Math.cos(a)).toFixed(2) + ',' + (100 + rr * Math.sin(a)).toFixed(2) };
      paths += '<path d="M' + p(ang, R) + ' A' + R + ',' + R + ' 0 ' + l + ' 1 ' + p(a2, R) + ' L' + p(a2, r0) + ' A' + r0 + ',' + r0 + ' 0 ' + l + ' 0 ' + p(ang, r0) + 'Z" fill="' + PALETA[k % PALETA.length] + '"><title>' + esc(x.etiqueta) + ': ' + esc(fmt(x.valor, f)) + '</title></path>'; ang = a2 });
    svg = '<svg class="graf" viewBox="0 0 200 200" style="max-width:260px;margin:0 auto">' + paths + '<text x="100" y="98" text-anchor="middle" style="font-size:15px;font-weight:700;fill:var(--tinta)">' + esc(fmt(tot, f)) + '</text><text x="100" y="116" text-anchor="middle">total</text></svg>';
    cont.innerHTML = svg; cont.appendChild(h('div', { class: 'leyenda' }, d.map(function(x, k){ return h('span', null, [h('i', { style: 'background:' + PALETA[k % PALETA.length] }), x.etiqueta + ' · ' + fmt(x.valor, f) + ' (' + Math.round(x.valor / tot * 100) + '%)']) }))); return }
  var W = 460, H = 230, ml = 62, mb = 34, mt = 10, mr = 8, max = Math.max.apply(null, d.map(function(x){ return x.valor }).concat([0])), min = Math.min.apply(null, d.map(function(x){ return x.valor }).concat([0])); if (max === min) max = min + 1;
  var y = function(v){ return mt + (H - mt - mb) * (1 - (v - min) / (max - min)) }, paso = (W - ml - mr) / d.length, g = '';
  for (var t = 0; t <= 4; t++){ var v = min + (max - min) * t / 4, yy = y(v); g += '<line class="guia" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/><text x="' + (ml - 6) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + esc(corto(v, f)) + '</text>' }
  var etiq = function(x, k){ var cx = ml + paso * k + paso / 2; var lim = Math.max(6, Math.floor(paso / 6.2)); var e = String(x.etiqueta); if (e.length > lim) e = e.slice(0, lim - 1) + '…'; return '<text x="' + cx.toFixed(1) + '" y="' + (H - mb + 16) + '" text-anchor="middle">' + esc(e) + '</text>' };
  if (tipo === 'lineas'){ var pts = d.map(function(x, k){ return (ml + paso * k + paso / 2).toFixed(1) + ',' + y(x.valor).toFixed(1) });
    g += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--acento)" stroke-width="2.5" stroke-linejoin="round"/>' + d.map(function(x, k){ return '<circle cx="' + (ml + paso * k + paso / 2).toFixed(1) + '" cy="' + y(x.valor).toFixed(1) + '" r="3.5" fill="var(--acento)"><title>' + esc(x.etiqueta) + ': ' + esc(fmt(x.valor, f)) + '</title></circle>' + etiq(x, k) }).join('') }
  else { var bw = Math.min(46, paso * 0.62); g += d.map(function(x, k){ var cx = ml + paso * k + paso / 2, y0 = y(Math.max(0, min)), y1 = y(x.valor); return '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, Math.abs(y0 - y1)).toFixed(1) + '" rx="4" fill="' + (b.colores ? PALETA[k % PALETA.length] : 'var(--acento)') + '"><title>' + esc(x.etiqueta) + ': ' + esc(fmt(x.valor, f)) + '</title></rect>' + etiq(x, k) }).join('') }
  g += '<line class="eje" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(Math.max(0, min)).toFixed(1) + '" y2="' + y(Math.max(0, min)).toFixed(1) + '"/>';
  cont.innerHTML = '<svg class="graf" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(b.titulo || 'gráfico') + '">' + g + '</svg>' }
  derivados.push(pintar); pintar(); return cont };

// ---------- página ----------
function construir(){
  raiz.innerHTML = '';
  (E.secciones || []).forEach(function(s){ var sec = h('section', { class: 'seccion' }, [s.titulo ? h('h2', { text: s.titulo }) : null, s.descripcion ? h('p', { class: 'desc', text: s.descripcion }) : null]);
    var rej = h('div', { class: 'rejilla', style: '--cols:' + Math.max(1, Math.min(3, s.columnas || 1)) });
    (s.bloques || []).forEach(function(b){ var f = B[b.tipo]; var cuerpo; try { cuerpo = f ? f(b) : h('div', { class: 'error-espec', text: 'Bloque desconocido: ' + b.tipo }) } catch (e) { cuerpo = h('div', { class: 'error-espec', text: 'Error en el bloque ' + (b.titulo || b.tipo) + ': ' + e.message }) }
      if (b.tipo === 'kpis' && !b.titulo){ var envu = h('div', { style: 'grid-column:1/-1' }, [cuerpo]); rej.appendChild(envu); return }
      rej.appendChild(h('div', { class: 'tarjeta', style: b.ancho ? 'grid-column:1/-1' : null }, [b.titulo ? h('h3', { text: b.titulo }) : null, b.descripcion ? h('p', { class: 'desc', text: b.descripcion }) : null, cuerpo])) });
    sec.appendChild(rej); raiz.appendChild(sec) });
  refrescarDerivados() }

document.getElementById('exportar').addEventListener('click', function(){ var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(D, null, 2)], { type: 'application/json' })); a.download = (E.nombre || 'artefacto') + '.datos.json'; document.body.appendChild(a); a.click(); a.remove() });
document.getElementById('importar').addEventListener('change', function(ev){ var f = ev.target.files[0]; if (!f) return; f.text().then(function(t){ mezclar(D, JSON.parse(t)); guardar(true); construir(); toast('Datos importados') }).catch(function(){ toast('Ese archivo no es válido') }) });
document.getElementById('imprimir').addEventListener('click', function(){ window.print() });
cargar(construir);
window.__artefacto = { datos: function(){ return D }, evaluar: evaluar };
})();
`
