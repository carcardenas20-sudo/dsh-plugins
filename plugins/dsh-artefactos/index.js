// dsh-artefactos — páginas interactivas (formularios, tablas, calculadoras, tableros,
// listas de tareas, gráficos) que el agente crea y que LEE cuando el usuario ingresa datos.
//
// - artefacto_crear: el agente describe la página por bloques; el plugin la dibuja con un
//   diseño cuidado (claro/oscuro, celular) en artefactos/<nombre>.html.
// - Un servidor local (solo 127.0.0.1, con token) sirve la página y guarda lo que escribes
//   en artefactos/<nombre>.datos.json, dentro del proyecto.
// - artefacto_leer: el agente lee esos datos para analizarlos, resumirlos o usarlos.

import http from 'node:http'
import crypto from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { CSS, RUNTIME } from './kit.js'

export const name = 'artefactos'
export const inject = ['tools', 'workingDirectory']

const DEFAULTS = { carpeta: 'artefactos', puerto: 47821, host: '127.0.0.1', maxDatosMB: 5 }

export const TIPOS_BLOQUE = ['texto', 'kpis', 'formulario', 'tabla', 'lista', 'notas', 'calculadora', 'grafico']
export const TIPOS_CAMPO = ['texto', 'numero', 'dinero', 'porcentaje', 'fecha', 'hora', 'seleccion', 'si_no', 'area', 'email', 'telefono']

export const slug = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'artefacto'
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// JSON seguro dentro de <script>
const jsonScript = (v) => JSON.stringify(v ?? null).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

// ---------- validación de la especificación ----------

export function validar(espec) {
  const err = []
  if (!String(espec?.titulo ?? '').trim()) err.push('falta "titulo"')
  const secciones = espec?.secciones
  if (!Array.isArray(secciones) || !secciones.length) err.push('falta "secciones" (al menos una con bloques)')
  const ids = new Set()
  const conDatos = new Set()
  for (const [i, s] of (secciones ?? []).entries()) {
    if (!Array.isArray(s?.bloques) || !s.bloques.length) { err.push(`la sección ${i + 1} no tiene "bloques"`); continue }
    for (const b of s.bloques) {
      const donde = `bloque "${b?.titulo ?? b?.tipo ?? '?'}" (sección ${i + 1})`
      if (!TIPOS_BLOQUE.includes(b?.tipo)) { err.push(`${donde}: "tipo" debe ser uno de ${TIPOS_BLOQUE.join(', ')}`); continue }
      if (['formulario', 'tabla', 'lista', 'notas', 'calculadora'].includes(b.tipo)) {
        if (!b.id || !/^[A-Za-z_][\w]*$/.test(b.id)) err.push(`${donde}: necesita "id" sin espacios ni tildes (ej. ventas, inventario)`)
        else if (ids.has(b.id)) err.push(`id repetido: ${b.id}`)
        else { ids.add(b.id); if (b.tipo === 'formulario' || b.tipo === 'tabla') conDatos.add(b.id) }
      }
      if (b.tipo === 'formulario') {
        if (!Array.isArray(b.campos) || !b.campos.length) err.push(`${donde}: necesita "campos"`)
        for (const c of b.campos ?? []) {
          if (!c?.id || !/^[A-Za-z_][\w]*$/.test(c.id)) err.push(`${donde}: cada campo necesita "id" sin espacios ni tildes`)
          if (c?.tipo && !TIPOS_CAMPO.includes(c.tipo)) err.push(`${donde}: tipo de campo "${c.tipo}" no existe (${TIPOS_CAMPO.join(', ')})`)
          if (c?.tipo === 'seleccion' && !Array.isArray(c.opciones)) err.push(`${donde}: el campo "${c.id}" es de selección y necesita "opciones"`)
        }
      }
      if (b.tipo === 'tabla' && (!Array.isArray(b.columnas) || !b.columnas.length)) err.push(`${donde}: necesita "columnas"`)
      if (b.tipo === 'calculadora') {
        if (!Array.isArray(b.entradas) || !b.entradas.length) err.push(`${donde}: necesita "entradas"`)
        if (!Array.isArray(b.resultados) || !b.resultados.length) err.push(`${donde}: necesita "resultados" con "formula"`)
      }
      if (b.tipo === 'kpis' && (!Array.isArray(b.items) || !b.items.length)) err.push(`${donde}: necesita "items"`)
      if (b.tipo === 'grafico' && !b.fuente && !Array.isArray(b.datos)) err.push(`${donde}: necesita "datos" o "fuente"`)
    }
  }
  for (const s of secciones ?? []) for (const b of s?.bloques ?? []) {
    if (b?.tipo === 'grafico' && b.fuente?.de && !conDatos.has(b.fuente.de)) err.push(`el gráfico "${b.titulo ?? ''}" usa fuente.de="${b.fuente.de}", que no es un formulario ni una tabla`)
  }
  return err
}

// ---------- HTML ----------

export function renderizar(espec, { conexion = null } = {}) {
  const acento = /^#[0-9a-f]{3,8}$/i.test(espec.color ?? '') ? espec.color : '#2d6cdf'
  const inicial = esc(String(espec.titulo).trim().slice(0, 1).toUpperCase())
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="dsh-artefactos">
<title>${esc(espec.titulo)}</title>
<style>${CSS}
:root{--acento:${acento}}</style>
</head>
<body>
<header class="cab"><div class="cab-in">
<div class="marca">${inicial}</div>
<div><h1>${esc(espec.titulo)}</h1>${espec.subtitulo ? `<p class="sub">${esc(espec.subtitulo)}</p>` : ''}</div>
<div class="esp"></div>
<span id="estado" class="chip no-imprimir"><i></i><span>Cargando…</span></span>
<button class="btn chico" id="imprimir" type="button">Imprimir</button>
<button class="btn chico" id="exportar" type="button">Exportar datos</button>
<label class="btn chico" style="margin:0">Importar<input id="importar" type="file" accept="application/json,.json" hidden></label>
</div></header>
<main>
${espec.descripcion ? `<p class="intro">${esc(espec.descripcion)}</p>` : ''}
<noscript><div class="error-espec">Esta página necesita JavaScript. Ábrela con el enlace que te dio el agente (http://127.0.0.1…) o en tu navegador.</div></noscript>
<div id="app"></div>
</main>
<div class="pie">Creado con dsh-artefactos · los datos se guardan en el proyecto cuando abres la página desde Harness.</div>
<script>window.__ESPEC__=${jsonScript(espec)};window.__CONEXION__=${jsonScript(conexion)};</script>
<script>${RUNTIME}</script>
</body>
</html>
`
}

// ---------- resumen de datos para el agente ----------

export function resumirDatos(espec, datos, max = 40000) {
  if (!datos) return 'Todavía no hay datos guardados: el usuario no ha ingresado nada en esta página (o la abrió sin el servidor local y quedó solo en su navegador; puede usar "Exportar datos").'
  const lineas = [`Datos de "${espec?.titulo ?? '?'}" — última actualización: ${datos.actualizado ?? 'desconocida'}`]
  const bloques = (espec?.secciones ?? []).flatMap((s) => s.bloques ?? [])
  const porId = new Map(bloques.filter((b) => b.id).map((b) => [b.id, b]))
  const md = (filas, cols) => {
    if (!filas.length) return '(vacío)'
    const head = `| ${cols.map((c) => c.etiqueta ?? c.id).join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |`
    return head + '\n' + filas.map((f) => `| ${cols.map((c) => String(f[c.id] ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`).join('\n')
  }
  for (const [id, filas] of Object.entries(datos.registros ?? {})) {
    const b = porId.get(id)
    const cols = (b?.campos ?? Object.keys(filas[0] ?? {}).filter((k) => !k.startsWith('_')).map((k) => ({ id: k })))
    lineas.push(`\n## Formulario "${b?.titulo ?? id}" (id ${id}): ${filas.length} registros`, md(filas, [...cols, { id: '_fecha', etiqueta: 'registrado' }]))
  }
  for (const [id, filas] of Object.entries(datos.tablas ?? {})) {
    const b = porId.get(id)
    const cols = b?.columnas ?? Object.keys(filas[0] ?? {}).map((k) => ({ id: k }))
    lineas.push(`\n## Tabla "${b?.titulo ?? id}" (id ${id}): ${filas.length} filas`, md(filas, cols))
  }
  for (const [id, items] of Object.entries(datos.listas ?? {})) {
    const b = porId.get(id)
    lineas.push(`\n## Lista "${b?.titulo ?? id}" (id ${id}): ${items.filter((x) => x.hecho).length} de ${items.length} hechas`, ...items.map((x) => `- [${x.hecho ? 'x' : ' '}] ${x.texto}`))
  }
  for (const [id, texto] of Object.entries(datos.notas ?? {})) {
    if (String(texto).trim()) lineas.push(`\n## Notas "${porId.get(id)?.titulo ?? id}" (id ${id})`, String(texto))
  }
  for (const [id, vals] of Object.entries(datos.calculos ?? {})) {
    const b = porId.get(id)
    lineas.push(`\n## Calculadora "${b?.titulo ?? id}" (id ${id}) — valores ingresados`, ...Object.entries(vals).map(([k, v]) => `- ${(b?.entradas ?? []).find((e) => e.id === k)?.etiqueta ?? k}: ${v}`))
  }
  const t = lineas.join('\n')
  return t.length > max ? `${t.slice(0, max)}\n\n[… recortado: ${t.length - max} caracteres más; pide un bloque específico con "bloque"]` : t
}

// ---------- plugin ----------

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const espacios = new Map() // token -> cwd
  const tokenDe = new Map() // cwd -> token
  let servidor = null
  let base = null

  const carpetaDe = (cwd) => path.join(cwd, cfg.carpeta)
  const leerTexto = async (f) => { try { return await readFile(f, 'utf8') } catch (e) { if (e?.code === 'ENOENT') return null; throw e } }
  async function escribirAtomico(f, t) {
    await mkdir(path.dirname(f), { recursive: true })
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, t, 'utf8')
    await rename(tmp, f)
  }
  const nombreValido = (n) => /^[a-z0-9][a-z0-9-]{0,59}$/.test(n)

  async function asegurarServidor() {
    if (servidor) return base
    servidor = http.createServer((req, res) => { atender(req, res).catch((e) => { try { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end(String(e?.message ?? e)) } catch {} }) })
    const escuchar = (puerto) => new Promise((ok, mal) => {
      const onErr = (e) => { servidor.off('listening', onOk); mal(e) }
      const onOk = () => { servidor.off('error', onErr); ok() }
      servidor.once('error', onErr); servidor.once('listening', onOk)
      servidor.listen(puerto, cfg.host)
    })
    try { await escuchar(cfg.puerto) } catch (e) {
      if (e?.code !== 'EADDRINUSE') { servidor = null; throw e }
      await escuchar(0) // puerto ocupado: uno libre cualquiera
    }
    servidor.unref?.()
    base = `http://${cfg.host}:${servidor.address().port}`
    return base
  }
  ctx.effect?.(() => () => { try { servidor?.close() } catch {} servidor = null; base = null }, 'artefactos.servidor')

  function tokenPara(cwd) {
    let t = tokenDe.get(cwd)
    if (!t) { t = crypto.randomBytes(12).toString('hex'); tokenDe.set(cwd, t); espacios.set(t, cwd) }
    return t
  }

  async function atender(req, res) {
    const url = new URL(req.url, 'http://x')
    const m = url.pathname.match(/^\/a\/([a-f0-9]{24})\/([a-z0-9][a-z0-9-]{0,59})(\.html|\/datos)?$/)
    const seguridad = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' }
    if (!m || !espacios.has(m[1])) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...seguridad }); res.end('No encontrado. Pídele al agente el enlace actualizado (artefacto_abrir).'); return }
    const cwd = espacios.get(m[1]); const nombre = m[2]; const dir = carpetaDe(cwd)
    if (!m[3] || m[3] === '.html') {
      if (req.method !== 'GET') { res.writeHead(405, seguridad); res.end(); return }
      const especTxt = await leerTexto(path.join(dir, `${nombre}.espec.json`))
      if (!especTxt) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...seguridad }); res.end('Ese artefacto no existe en este proyecto.'); return }
      const html = renderizar(JSON.parse(especTxt), { conexion: { datos: `/a/${m[1]}/${nombre}/datos` } })
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...seguridad }); res.end(html); return
    }
    const fDatos = path.join(dir, `${nombre}.datos.json`)
    if (req.method === 'GET') {
      const t = await leerTexto(fDatos)
      if (t == null) { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...seguridad }); res.end('null'); return }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...seguridad }); res.end(t); return
    }
    if (req.method === 'PUT') {
      // Solo la propia página puede escribir (mismo origen); bloquea otros sitios.
      const origen = req.headers.origin
      if (origen && origen !== base) { res.writeHead(403, seguridad); res.end(); return }
      if (!String(req.headers['content-type'] ?? '').includes('application/json')) { res.writeHead(415, seguridad); res.end(); return }
      const max = cfg.maxDatosMB * 1024 * 1024
      let tam = 0; const partes = []
      for await (const c of req) { tam += c.length; if (tam > max) { res.writeHead(413, seguridad); res.end(); req.destroy(); return } partes.push(c) }
      let datos
      try { datos = JSON.parse(Buffer.concat(partes).toString('utf8')) } catch { res.writeHead(400, seguridad); res.end(); return }
      if (!datos || typeof datos !== 'object' || Array.isArray(datos)) { res.writeHead(400, seguridad); res.end(); return }
      await escribirAtomico(fDatos, JSON.stringify(datos, null, 1))
      res.writeHead(204, seguridad); res.end(); return
    }
    res.writeHead(405, seguridad); res.end()
  }

  async function enlace(cwd, nombre) {
    const b = await asegurarServidor()
    return `${b}/a/${tokenPara(cwd)}/${nombre}.html`
  }

  async function listar(cwd) {
    let archivos = []
    try { archivos = await readdir(carpetaDe(cwd)) } catch {}
    const out = []
    for (const f of archivos.filter((x) => x.endsWith('.espec.json')).sort()) {
      const nombre = f.slice(0, -'.espec.json'.length)
      let titulo = nombre
      try { titulo = JSON.parse(await readFile(path.join(carpetaDe(cwd), f), 'utf8')).titulo ?? nombre } catch {}
      let actualizado = null
      try { actualizado = (await stat(path.join(carpetaDe(cwd), `${nombre}.datos.json`))).mtime.toISOString() } catch {}
      out.push({ nombre, titulo, actualizado })
    }
    return out
  }

  const salidaTexto = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }
  const exigirNombre = (n) => { const s = slug(n); if (!nombreValido(s)) throw new Error(`nombre inválido: ${n}`); return s }

  const campoSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Sin espacios ni tildes: cliente, valor, fecha_entrega' },
      etiqueta: { type: 'string' },
      tipo: { type: 'string', enum: TIPOS_CAMPO },
      opciones: { type: 'array', items: { type: 'string' } },
      requerido: { type: 'boolean' },
      placeholder: { type: 'string' },
      ancho: { type: 'boolean', description: 'Ocupa toda la fila' },
      total: { type: 'boolean', description: 'Sumar esta columna numérica en la tabla' },
      formula: { type: 'string', description: 'Solo en columnas de tabla: se calcula con las otras columnas de la fila, ej. cantidad * precio' },
      enTabla: { type: 'boolean', description: 'false = no mostrar en la tabla de registros' },
    },
    required: ['id'],
  }

  ctx.tools.register({
    name: 'artefacto_crear',
    description: [
      'Crea (o actualiza) una página interactiva y bonita dentro del proyecto: formularios que guardan registros, tablas editables con totales y fórmulas, calculadoras, tableros con indicadores (KPIs) y gráficos, listas de tareas y notas.',
      'Lo que el usuario ingresa se guarda en el proyecto (artefactos/<nombre>.datos.json) y lo lees con artefacto_leer.',
      'Úsala cuando el usuario pida una herramienta, formulario, registro, control, inventario, cotizador, calculadora, tablero o seguimiento. Diséñala completa: bloques útiles, ids claros, campos con tipo correcto (dinero, fecha, seleccion…), KPIs y gráficos que se alimenten de los datos.',
      'Bloques (tipo): texto {contenido en markdown}; kpis {items:[{etiqueta, valor | formula, formato, nota}]}; formulario {id, campos, boton}; tabla {id, columnas, filas, editable}; lista {id, items}; notas {id}; calculadora {id, entradas, resultados:[{etiqueta, formula, formato}]}; grafico {forma: barras|lineas|torta, datos:[{etiqueta, valor}] o fuente:{de: id, x: campo, y: campo, agregacion: suma|contar|promedio}, formato}.',
      'Fórmulas: + - * / ( ), comparaciones y funciones suma, promedio, contar, min, max, redondear, si, abs. Variables: id de formulario/tabla (filas) y id.campo (columna), p. ej. suma(ventas.total), contar(ventas), promedio(inventario.costo); en calculadoras, los ids de las entradas y de resultados anteriores.',
      'Formatos: dinero (pesos), numero, decimal, porcentaje, fecha. Si vuelves a crear con el mismo nombre, se actualiza el diseño y se conservan los datos.',
      'Después: llama present con el archivo .html y dale al usuario el enlace http://127.0.0.1… (ahí se guardan los datos en el proyecto).',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre corto del archivo (sin tildes): control-ventas. Por defecto, el título' },
        titulo: { type: 'string' },
        subtitulo: { type: 'string' },
        descripcion: { type: 'string', description: 'Una o dos frases arriba de la página' },
        color: { type: 'string', description: 'Color de acento en hex, ej. #2d6cdf (azul), #f5c400 (amarillo XT)' },
        moneda: { type: 'string', description: 'Por defecto COP' },
        secciones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              titulo: { type: 'string' }, descripcion: { type: 'string' },
              columnas: { type: 'number', description: '1 a 3 tarjetas por fila' },
              bloques: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    tipo: { type: 'string', enum: TIPOS_BLOQUE },
                    id: { type: 'string' }, titulo: { type: 'string' }, descripcion: { type: 'string' }, ancho: { type: 'boolean' },
                    contenido: { type: 'string' },
                    items: { type: 'array', items: {} },
                    campos: { type: 'array', items: campoSchema },
                    columnas: { type: 'array', items: campoSchema },
                    filas: { type: 'array', items: {} },
                    entradas: { type: 'array', items: campoSchema },
                    resultados: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, etiqueta: { type: 'string' }, formula: { type: 'string' }, formato: { type: 'string' }, destacado: { type: 'boolean' } }, required: ['etiqueta', 'formula'] } },
                    forma: { type: 'string', enum: ['barras', 'lineas', 'torta'] },
                    datos: { type: 'array', items: {} },
                    fuente: { type: 'object', properties: { de: { type: 'string' }, x: { type: 'string' }, y: { type: 'string' }, agregacion: { type: 'string', enum: ['suma', 'contar', 'promedio'] }, ordenar: { type: 'string' }, max: { type: 'number' } } },
                    formato: { type: 'string' }, boton: { type: 'string' }, editable: { type: 'boolean' },
                  },
                  required: ['tipo'],
                },
              },
            },
            required: ['bloques'],
          },
        },
        datosIniciales: { type: 'object', description: 'Opcional: datos de ejemplo o reales para precargar {registros:{id:[...]}, tablas:{id:[...]}, listas:{id:[{texto, hecho}]}}. Solo se usan si aún no hay datos guardados' },
      },
      required: ['titulo', 'secciones'],
    },
    output: salidaTexto,
    async execute(args, exec) {
      const espec = structuredClone(args ?? {})
      // "forma" del gráfico se guarda como tipo de gráfico interno
      for (const s of espec.secciones ?? []) for (const b of s.bloques ?? []) {
        if (b.tipo === 'grafico') { b.tipoGrafico = b.forma ?? 'barras' }
      }
      const errores = validar(espec)
      if (errores.length) throw new Error(`No pude crear el artefacto:\n- ${errores.join('\n- ')}\nCorrige y vuelve a llamar artefacto_crear.`)
      const nombre = exigirNombre(espec.nombre || espec.titulo)
      espec.nombre = nombre
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const dir = carpetaDe(cwd)
      const yaHabia = await leerTexto(path.join(dir, `${nombre}.espec.json`))
      const hayDatos = await leerTexto(path.join(dir, `${nombre}.datos.json`))
      await escribirAtomico(path.join(dir, `${nombre}.espec.json`), JSON.stringify(espec, null, 1))
      // Versión autónoma (sin servidor): se puede abrir o enviar; guarda en el navegador.
      await escribirAtomico(path.join(dir, `${nombre}.html`), renderizar(espec))
      if (espec.datosIniciales && !hayDatos) await escribirAtomico(path.join(dir, `${nombre}.datos.json`), JSON.stringify({ version: 1, registros: {}, tablas: {}, listas: {}, notas: {}, calculos: {}, ...espec.datosIniciales, actualizado: new Date().toISOString() }, null, 1))
      const url = await enlace(cwd, nombre)
      const rel = `${cfg.carpeta}/${nombre}.html`
      return [
        `${yaHabia ? 'Actualicé' : 'Creé'} el artefacto "${espec.titulo}"${yaHabia && hayDatos ? ' (los datos que ya tenía se conservan)' : ''}.`,
        `Enlace para usarlo y que los datos se guarden en el proyecto: ${url}`,
        `Archivo: ${rel} (versión para abrir o enviar; ahí los datos quedan solo en ese navegador).`,
        `Dale al usuario el enlace como texto clicable y dile que lo abra en el navegador del panel lateral de Harness (o en su navegador). Llama present con ${rel} si quiere el archivo. Cuando el usuario diga que ya ingresó datos, léelos con artefacto_leer { nombre: "${nombre}" }.`,
      ].join('\n')
    },
  })

  ctx.tools.register({
    name: 'artefacto_leer',
    description: 'Lee lo que el usuario ingresó en un artefacto (registros de formularios, tablas, listas, notas y valores de calculadoras), en tablas listas para analizar. Úsala cuando el usuario diga que llenó, registró o actualizó algo en una página creada con artefacto_crear.',
    parameters: { type: 'object', properties: { nombre: { type: 'string' }, json: { type: 'boolean', description: 'true = devolver el JSON crudo' } }, required: ['nombre'] },
    output: salidaTexto,
    async execute(args, exec) {
      const nombre = exigirNombre(args?.nombre)
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const especTxt = await leerTexto(path.join(carpetaDe(cwd), `${nombre}.espec.json`))
      if (!especTxt) {
        const hay = await listar(cwd)
        throw new Error(`No existe el artefacto "${nombre}". ${hay.length ? `Hay: ${hay.map((x) => x.nombre).join(', ')}` : 'Este proyecto no tiene artefactos.'}`)
      }
      const datosTxt = await leerTexto(path.join(carpetaDe(cwd), `${nombre}.datos.json`))
      const datos = datosTxt ? JSON.parse(datosTxt) : null
      if (args?.json) return datosTxt ?? 'null'
      return resumirDatos(JSON.parse(especTxt), datos)
    },
  })

  ctx.tools.register({
    name: 'artefacto_abrir',
    description: 'Lista los artefactos del proyecto con su enlace actual (el enlace cambia si Harness se reinicia) y la fecha de sus últimos datos. Con "nombre", devuelve solo ese enlace.',
    parameters: { type: 'object', properties: { nombre: { type: 'string' } } },
    output: salidaTexto,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const todos = await listar(cwd)
      const lista = args?.nombre ? todos.filter((x) => x.nombre === slug(args.nombre)) : todos
      if (!lista.length) return args?.nombre ? `No existe "${args.nombre}". Hay: ${todos.map((x) => x.nombre).join(', ') || 'ninguno'}` : 'Este proyecto todavía no tiene artefactos. Créalos con artefacto_crear.'
      const out = []
      for (const a of lista) out.push(`- ${a.titulo} (${a.nombre}): ${await enlace(cwd, a.nombre)}${a.actualizado ? ` · datos actualizados ${a.actualizado}` : ' · sin datos todavía'}`)
      return `Artefactos del proyecto:\n${out.join('\n')}\nDale al usuario el enlace para abrirlo.`
    },
  })
}
