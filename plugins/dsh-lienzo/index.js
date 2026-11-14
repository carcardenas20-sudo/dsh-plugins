// dsh-lienzo — páginas visuales de calidad dentro de DeepSeek Harness.
//
// El agente escribe el contenido con un kit de diseño (tipografía, color, modo oscuro,
// celular, storyboard con maquetas de pantalla, pasos, carriles, línea de tiempo,
// KPIs, tablas, pestañas…). El plugin arma el HTML completo, lo abre en un navegador
// invisible, lo mide en escritorio y celular, toma capturas y le devuelve al agente
// los problemas concretos. Si al terminar el turno quedan problemas, lo obliga a corregir.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { CSS, JS, GUIA } from './kit.js'
import { revisar, recursosExternos } from './revisor.js'

export const name = 'lienzo'
export const inject = ['tools', 'workingDirectory', 'systemPrompt']

const DEFAULTS = { carpeta: 'lienzos', navegador: null, rondas: 2, capturas: true }
const MUTA = /^(write|edit|multi_?edit|apply_?patch|create|str_replace|patch)/i
const SOURCE_KIND = 'dsh-lienzo'

export const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'lienzo'

const escapar = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function rutaSegura(cwd, archivo) {
  const full = path.resolve(cwd, archivo)
  const rel = path.relative(cwd, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`"archivo" debe quedar dentro del proyecto (recibí: ${archivo})`)
  if (!/\.html?$/i.test(full)) throw new Error('"archivo" debe terminar en .html')
  return { full, rel: rel.split(path.sep).join('/') }
}

const MARCA = 'dsh-lienzo'

export function documento({ titulo, cuerpo, estilos = '' }) {
  let c = String(cuerpo ?? '').trim()
  // Si el modelo mandó un documento completo, nos quedamos con el body.
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(c)
  if (body) c = body[1].trim()
  c = c.replace(/<script\b[^>]*\bsrc=["'][^"']*lz[^"']*["'][^>]*><\/script>/gi, '')
  if (!/class=["'][^"']*\blz-pagina\b/.test(c)) c = `<div class="lz-pagina">\n${c}\n</div>`
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${MARCA}">
<title>${escapar(titulo)}</title>
<style>${CSS}
.lz-tema-boton{position:absolute;top:14px;right:14px;z-index:20;width:36px;height:36px;border-radius:50%;border:1px solid var(--borde-2);background:var(--panel);color:var(--suave);cursor:pointer;box-shadow:var(--sombra);display:grid;place-items:center;padding:0}
.lz-tema-boton:hover{color:var(--acento);border-color:var(--acento)}
@media print{.lz-tema-boton{display:none}}
</style>
${estilos.trim() ? `<style>\n${estilos.replace(/<\/style/gi, '')}\n</style>\n` : ''}</head>
<body>
<button class="lz-tema-boton" data-lz-tema title="Cambiar entre claro y oscuro" aria-label="Cambiar tema"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg></button>
${c}
<script>${JS}</script>
</body>
</html>
`
}

export function textoRevision(rev, { rel, externos = [], cwd } = {}) {
  const l = []
  const problemas = [...(rev?.problemas ?? [])]
  for (const e of externos) problemas.unshift({ tipo: 'recurso de internet', gravedad: 'alta', donde: e, detalle: 'la página debe abrir sin conexión: quítalo o reemplázalo por algo del kit', vistas: ['archivo'] })
  if (!rev?.disponible) {
    l.push(`⚠️ No pude revisar la página visualmente: ${rev?.motivo ?? 'sin navegador'}. Revisa con cuidado que use solo piezas del kit.`)
    if (externos.length) l.push(...externos.map((e) => `- Recurso de internet: ${e}`))
    return { texto: l.join('\n'), problemas }
  }
  const serios = problemas.filter((p) => p.gravedad !== 'baja')
  if (!serios.length) l.push('✅ Revisión visual sin problemas (escritorio 1280 px y celular 390 px).')
  else {
    l.push(`❌ La revisión visual encontró ${serios.length} problema(s). Corrígelos TODOS y vuelve a llamar lienzo_crear con el mismo archivo (o edítalo y llama lienzo_revisar):`)
    serios.slice(0, 14).forEach((p, i) => l.push(`${i + 1}. [${p.gravedad}] ${p.tipo}${p.donde ? ` — ${p.donde}` : ''}: ${p.detalle} (${p.vistas.join(' y ')})`))
    if (serios.length > 14) l.push(`… y ${serios.length - 14} más.`)
  }
  if (rev.medidas?.escritorio) l.push(`Medidas: alto ${rev.medidas.escritorio.alto} px en escritorio, ${rev.medidas.celular?.alto ?? '?'} px en celular; ${rev.medidas.escritorio.elementosKit} elementos del kit.`)
  if (rev.capturas?.length) l.push(`Capturas: ${rev.capturas.map((c) => (cwd ? path.relative(cwd, c) : c).split(path.sep).join('/')).join(', ')}`)
  return { texto: l.join('\n'), problemas: serios }
}

function guiaTexto(pieza) {
  if (pieza && GUIA.piezas[pieza]) return `PIEZA: ${pieza}\n${GUIA.piezas[pieza]}`
  return [
    GUIA.reglas,
    '',
    'PIEZAS DEL KIT (copia la estructura y cambia el contenido):',
    ...Object.entries(GUIA.piezas).map(([k, v]) => `\n### ${k}\n${v}`),
  ].join('\n')
}

const REGLAS = [
  '## Lienzo (dsh-lienzo)',
  'When the user asks for a visual page — an explainer, a user journey, a process with screens, a proposal, a report, a comparison, a mockup, a roadmap, a "show me how it would look" — build it with lienzo_crear, not hand-written HTML files and not plain markdown.',
  'Call lienzo_guia once per session before your first lienzo to get the design rules and component catalog. Pick the format by content (user journey → storyboard with screen mockups; who does what → carriles; numbers → KPIs + table; options → comparar).',
  'Base the content on the real project: read the specs/code first and use real names, times and rules. Short, concrete text.',
  'lienzo_crear returns a visual review (desktop and phone). Fix every reported problem and call it again with the same archivo before delivering. Then call present with the returned path.',
  'For graphs with many connections (architecture, database, networks) use visualizar (dsh-planos) instead.',
].join('\n')

const deepFreeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v) } return v }
const aviso = (text, summary) => deepFreeze({ role: 'user', id: globalThis.crypto.randomUUID(), content: [{ type: 'text', text }], source: { kind: SOURCE_KIND, form: 'notice', summary: summary.slice(0, 120) } })

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const estados = new WeakMap()
  const estado = (agent) => { let s = estados.get(agent); if (!s) { s = { pendientes: new Map(), sucios: new Set(), rondas: 0 }; estados.set(agent, s) } return s }

  ctx.systemPrompt.section({ name: 'lienzo', order: 2470, interpolate: false, text: REGLAS })

  async function revisarArchivo(cwd, full, rel, signal) {
    const html = await readFile(full, 'utf8')
    const externos = recursosExternos(html)
    let rev
    try {
      rev = await revisar(full, {
        navegador: cfg.navegador,
        carpetaCapturas: cfg.capturas ? path.join(cwd, cfg.carpeta, 'capturas') : null,
        base: path.basename(full).replace(/\.html?$/i, ''),
        signal,
      })
    } catch (e) {
      rev = { disponible: false, motivo: `falló el navegador (${e?.message ?? e})` }
    }
    return textoRevision(rev, { rel, externos, cwd })
  }

  ctx.tools.register({
    name: 'lienzo_guia',
    description: 'Reglas de diseño y catálogo de piezas del kit de dsh-lienzo (storyboard con maquetas de pantalla, pasos, flujo, carriles, línea de tiempo, KPIs, tarjetas, tabla, comparar, pestañas, notas, plegables) con HTML de ejemplo. Llámala antes del primer lienzo de la sesión.',
    parameters: { type: 'object', properties: { pieza: { type: 'string', enum: Object.keys(GUIA.piezas), description: 'Solo una pieza (opcional)' } } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) { return guiaTexto(args?.pieza) },
  })

  ctx.tools.register({
    name: 'lienzo_crear',
    description:
      'Crea o reemplaza una página visual (HTML autocontenido con el kit de diseño de dsh-lienzo) en lienzos/<nombre>.html, ' +
      'la revisa en un navegador invisible en escritorio y celular y devuelve los problemas encontrados y capturas. ' +
      '"cuerpo" es SOLO el contenido (lo que va dentro de <body>) usando las clases lz- del kit; el plugin pone estilos, modo oscuro y comportamiento. ' +
      'Para corregir, vuelve a llamarla con el mismo "archivo". Al final llama present con la ruta.',
    timeoutMs: 3 * 60_000,
    parameters: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título de la pestaña del navegador' },
        cuerpo: { type: 'string', description: 'HTML del contenido, empezando por <div class="lz-pagina">…' },
        estilos: { type: 'string', description: 'CSS adicional opcional (usa las variables del kit: var(--acento), var(--suave)…)' },
        archivo: { type: 'string', description: 'Ruta dentro del proyecto. Por defecto lienzos/<titulo>.html' },
      },
      required: ['titulo', 'cuerpo'],
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args, exec) {
      if (!exec?.agent) throw new Error('lienzo_crear necesita una sesión con proyecto abierto')
      if (String(args?.cuerpo ?? '').trim().length < 40) throw new Error('"cuerpo" está vacío o es muy corto')
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { full, rel } = rutaSegura(cwd, args.archivo || path.join(cfg.carpeta, `${slug(args.titulo)}.html`))
      await mkdir(path.dirname(full), { recursive: true })
      const tmp = `${full}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, documento(args), 'utf8')
      await rename(tmp, full)
      const r = await revisarArchivo(cwd, full, rel, exec.signal)
      const s = estado(exec.agent)
      s.sucios.delete(full)
      if (r.problemas.length) s.pendientes.set(full, { rel, problemas: r.problemas }); else s.pendientes.delete(full)
      return `Guardado en ${rel}\n\n${r.texto}${r.problemas.length ? '' : `\n\nAhora llama present con "${rel}" y menciónalo entre comillas invertidas.`}`
    },
  })

  ctx.tools.register({
    name: 'lienzo_revisar',
    description: 'Vuelve a revisar visualmente (escritorio y celular) un HTML del proyecto, por ejemplo después de editarlo a mano. Devuelve problemas y capturas.',
    timeoutMs: 3 * 60_000,
    parameters: { type: 'object', properties: { archivo: { type: 'string', description: 'Ruta del .html dentro del proyecto' } }, required: ['archivo'] },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { full, rel } = rutaSegura(cwd, args.archivo)
      if (!existsSync(full)) throw new Error(`no existe ${rel}`)
      const r = await revisarArchivo(cwd, full, rel, exec.signal)
      if (exec.agent) {
        const s = estado(exec.agent)
        s.sucios.delete(full)
        if (r.problemas.length) s.pendientes.set(full, { rel, problemas: r.problemas }); else s.pendientes.delete(full)
      }
      return `${rel}\n\n${r.texto}`
    },
  })

  // Nuevo pedido del usuario: reinicia las rondas de corrección.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      if (decision?.kind === 'enter' && payload.agent && (decision.messages ?? []).some((m) => m?.source?.kind === 'user')) estado(payload.agent).rondas = 0
    } catch {}
    return decision
  })

  // Si el agente edita a mano un lienzo, queda pendiente de revisar.
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      if (exec?.agent && MUTA.test(exec.name ?? '')) {
        const a = exec.arguments ?? {}
        const r = a.file_path ?? a.path ?? a.filePath ?? a.file
        if (typeof r === 'string' && /\.html?$/i.test(r)) {
          const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
          const full = path.resolve(cwd, r)
          const txt = existsSync(full) ? await readFile(full, 'utf8').catch(() => '') : ''
          if (txt.includes(`content="${MARCA}"`) || full.startsWith(path.join(cwd, cfg.carpeta) + path.sep)) estado(exec.agent).sucios.add(full)
        }
      }
    } catch {}
    return next()
  })

  // Antes de entregar: si quedaron problemas sin corregir, el agente debe arreglarlos.
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const s = estados.get(agent)
    if (!s || s.rondas >= cfg.rondas) return
    try {
      if (s.sucios.size) {
        const cwd = await ctx.workingDirectory.ensure(agent, signal)
        for (const full of [...s.sucios]) {
          s.sucios.delete(full)
          if (!existsSync(full)) continue
          const rel = path.relative(cwd, full).split(path.sep).join('/')
          const r = await revisarArchivo(cwd, full, rel, signal)
          if (r.problemas.length) s.pendientes.set(full, { rel, problemas: r.problemas }); else s.pendientes.delete(full)
        }
      }
    } catch {}
    if (!s.pendientes.size || signal?.aborted) return
    s.rondas++
    const partes = [...s.pendientes.values()].map(({ rel, problemas }) =>
      `${rel}:\n${problemas.slice(0, 10).map((p, i) => `  ${i + 1}. [${p.gravedad}] ${p.tipo}${p.donde ? ` — ${p.donde}` : ''}: ${p.detalle}`).join('\n')}`)
    agent.steer(aviso([
      '[Lienzo] La revisión visual encontró problemas que siguen sin corregir. Corrígelos antes de entregar (lienzo_crear con el mismo archivo, o edita y llama lienzo_revisar):',
      '',
      ...partes,
    ].join('\n'), `Lienzo: ${s.pendientes.size} página(s) con problemas visuales`))
  })
}
