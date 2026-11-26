// Horarios de las automatizaciones: cron de 5 campos (minuto hora día mes día-semana) e intervalos ("90s", "15m", "2h", "1d").
// Ejemplos de cron: "0 18 * * 1-5" = lunes a viernes 6 pm · "*/10 7-19 * * *" = cada 10 min de 7 am a 7 pm · "0 8 1 * *" = día 1 de cada mes 8 am.
'use strict'

const ALIAS = { '@diario': '0 0 * * *', '@cada-hora': '0 * * * *', '@semanal': '0 0 * * 0', '@mensual': '0 0 1 * *' }
const RANGOS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
const NOMBRES = [null, null, null,
  { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12, jan: 1, apr: 4, aug: 8, dec: 12 },
  { dom: 0, lun: 1, mar: 2, mie: 3, mié: 3, jue: 4, vie: 5, sab: 6, sáb: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }]

function campo(texto, i) {
  const [min, max] = RANGOS[i]
  const valores = new Set()
  const num = (s) => {
    const n = NOMBRES[i]?.[s.toLowerCase()] ?? (/^\d+$/.test(s) ? Number(s) : NaN)
    if (!(n >= min && n <= max)) throw new Error(`"${s}" no vale en el campo ${i + 1} del cron (${min}-${max})`)
    return n
  }
  for (const parte of texto.split(',')) {
    const [rango, pasoTxt] = parte.split('/')
    const paso = pasoTxt === undefined ? 1 : Number(pasoTxt)
    if (!(paso >= 1)) throw new Error(`paso inválido en "${parte}"`)
    let [a, b] = rango === '*' ? [min, max] : rango.includes('-') ? rango.split('-').map(num) : [num(rango), pasoTxt ? max : num(rango)]
    if (a > b) throw new Error(`rango al revés en "${parte}"`)
    for (let v = a; v <= b; v += paso) valores.add(i === 4 && v === 7 ? 0 : v)
  }
  return { valores, todo: texto === '*' }
}

function parsearCron(expr) {
  const t = (ALIAS[expr.trim()] || expr).trim().split(/\s+/)
  if (t.length !== 5) throw new Error(`el cron debe tener 5 campos (minuto hora día mes día-semana): "${expr}"`)
  const [mi, ho, di, me, ds] = t.map(campo)
  return { mi, ho, di, me, ds }
}

/** Próxima fecha (después de `desde`) que cumple el cron, en hora local del PC. */
function siguienteCron(expr, desde = new Date()) {
  const c = typeof expr === 'string' ? parsearCron(expr) : expr
  const d = new Date(desde.getTime()); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1)
  const limite = desde.getTime() + 366 * 24 * 3600e3 * 4
  while (d.getTime() < limite) {
    if (!c.me.valores.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0); continue }
    // Como en cron clásico: si día y día-semana están restringidos, basta con que se cumpla uno.
    const okDia = c.di.todo && c.ds.todo ? true : c.di.todo ? c.ds.valores.has(d.getDay()) : c.ds.todo ? c.di.valores.has(d.getDate()) : c.di.valores.has(d.getDate()) || c.ds.valores.has(d.getDay())
    if (!okDia) { d.setDate(d.getDate() + 1); d.setHours(0, 0); continue }
    if (!c.ho.valores.has(d.getHours())) { d.setHours(d.getHours() + 1, 0); continue }
    if (!c.mi.valores.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1); continue }
    return d
  }
  throw new Error(`el cron "${expr}" nunca se cumple`)
}

/** "90s" "15m" "2h" "1d" "500ms" → milisegundos */
function duracion(txt, porDefecto) {
  if (txt === undefined || txt === null || txt === '') return porDefecto
  if (typeof txt === 'number') return txt
  const m = String(txt).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i)
  if (!m) throw new Error(`duración inválida "${txt}" (usa 30s, 15m, 2h, 1d)`)
  return Math.round(Number(m[1]) * { ms: 1, s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[m[2].toLowerCase()])
}

module.exports = { parsearCron, siguienteCron, duracion }
