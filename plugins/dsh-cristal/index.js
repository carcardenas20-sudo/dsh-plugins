// dsh-cristal — interfaces modernas, elegantes y con movimiento dentro de DeepSeek Harness.
//
// 1. Kit de diseño que se instala en el proyecto (CSS + un JS pequeño, sin dependencias):
//    tokens de color, tipografía, espacio y movimiento, componentes, modo oscuro, celular,
//    y la integración con Tailwind v3/v4. Funciona con React, HTML plano y plantillas Java.
// 2. Reglas de diseño y catálogo de piezas para el agente (cristal_guia).
// 3. Revisor: abre cada pantalla en el navegador del PC (escritorio claro, oscuro y celular),
//    mide lo visual y el movimiento, toma capturas y obliga a corregir antes de entregar.

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { textoGuia, PIEZAS } from './guia.js'
import { galeria } from './galeria.js'
import { paletaMarca, cssMarca } from './marca.js'
import { revisar, objetivoValido } from './revisor.js'

export const name = 'cristal'
export const inject = ['tools', 'workingDirectory', 'systemPrompt']

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const VERSION = '0.1.1'
const MARCADOR = '.dsh-cristal.json'
const DEFAULTS = { navegador: null, rondas: 2, carpetaCapturas: '.dsh-cristal/capturas', acento: '#0b63f6' }
const SOURCE_KIND = 'dsh-cristal'
const MUTA = /^(write|edit|multi_?edit|apply_?patch|create|str_replace|patch)/i
const UI = /\.(jsx|tsx|vue|svelte|html?|css|scss|astro)$/i

// ---------- detección del proyecto ----------

export async function detectarProyecto(cwd) {
  const leer = async (f) => { try { return await readFile(path.join(cwd, f), 'utf8') } catch { return null } }
  const pkgTxt = await leer('package.json')
  if (pkgTxt) {
    let pkg = {}
    try { pkg = JSON.parse(pkgTxt) } catch {}
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const tw = deps.tailwindcss ? (/^[\^~]?3/.test(deps.tailwindcss) ? 3 : 4) : deps['@tailwindcss/vite'] || deps['@tailwindcss/postcss'] ? 4 : 0
    const tsx = existsSync(path.join(cwd, 'src', 'main.tsx'))
    const entrada = ['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js', 'src/index.tsx', 'src/index.jsx', 'src/index.js'].find((f) => existsSync(path.join(cwd, f)))
    const cssPrincipal = ['src/index.css', 'src/App.css', 'src/styles.css', 'src/main.css', 'src/app.css'].find((f) => existsSync(path.join(cwd, f)))
    const tipo = deps.react ? 'react' : deps.vue ? 'vue' : deps.svelte ? 'svelte' : 'web'
    return { tipo, tailwind: tw, carpeta: existsSync(path.join(cwd, 'src')) ? 'src/cristal' : 'cristal', entrada, cssPrincipal, ts: tsx }
  }
  if ((await leer('pom.xml')) !== null || (await leer('build.gradle')) !== null || (await leer('build.gradle.kts')) !== null) {
    return { tipo: 'java', tailwind: 0, carpeta: 'src/main/resources/static/cristal' }
  }
  return { tipo: 'html', tailwind: 0, carpeta: 'cristal' }
}

export function instruccionesConexion(p, carpeta) {
  const rel = (desde) => {
    const r = path.posix.relative(path.posix.dirname(desde), carpeta)
    return r.startsWith('.') ? r : `./${r}`
  }
  if (p.tipo === 'react' || p.tipo === 'vue' || p.tipo === 'svelte' || (p.tipo === 'web' && p.entrada)) {
    const l = []
    if (p.tailwind === 4 && p.cssPrincipal) {
      l.push(`En ${p.cssPrincipal}, justo después de @import "tailwindcss"; (con layer(components) para que las utilidades de Tailwind puedan ajustar los componentes):`, `  @import "${rel(p.cssPrincipal)}/cristal.css" layer(components);`, `  @import "${rel(p.cssPrincipal)}/marca.css" layer(components);`, `  @import "${rel(p.cssPrincipal)}/cristal.tailwind.css";`)
      if (p.entrada) l.push(`En ${p.entrada}, con los demás imports:`, `  import "${rel(p.entrada)}/cristal.js"`)
    } else if (p.entrada) {
      l.push(`En ${p.entrada}, antes de importar tus propios estilos:`, `  import "${rel(p.entrada)}/cristal.css"`, `  import "${rel(p.entrada)}/marca.css"`, `  import "${rel(p.entrada)}/cristal.js"`)
      if (p.tailwind === 3) l.push('En tailwind.config.js agrega el preset:', `  presets: [require("./${carpeta}/cristal.tailwind3.cjs")]`)
    }
    if (p.ts) l.push(`Para TypeScript, en src/vite-env.d.ts (o cualquier .d.ts): interface Window { cristal: any }`)
    return l
  }
  if (p.tipo === 'java') return [
    'En el <head> de la plantilla base (Thymeleaf):',
    '  <link rel="stylesheet" th:href="@{/cristal/cristal.css}">',
    '  <link rel="stylesheet" th:href="@{/cristal/marca.css}">',
    '  <script th:src="@{/cristal/cristal.js}" defer></script>',
    '(Si no usas Thymeleaf, son las mismas rutas: /cristal/cristal.css, /cristal/marca.css y /cristal/cristal.js.)',
  ]
  return [
    'En el <head> de cada página:',
    `  <link rel="stylesheet" href="${carpeta}/cristal.css">`,
    `  <link rel="stylesheet" href="${carpeta}/marca.css">`,
    `  <script src="${carpeta}/cristal.js" defer></script>`,
    '(Ajusta la ruta relativa si la página está en una subcarpeta.)',
  ]
}

const LEEME = (p, carpeta, marca) => `# Cristal

Sistema de diseño de este proyecto (instalado con dsh-cristal ${VERSION}).

| Archivo | Para qué |
|---|---|
| \`cristal.css\` | Tokens (color, tipografía, espacio, movimiento), componentes, modo oscuro y celular. No lo edites: se reemplaza al actualizar. |
| \`marca.css\` | El color de marca (${marca.base}) y sus variantes legibles. Este sí es tuyo. |
| \`cristal.js\` | Hojas, avisos, pestañas, control segmentado, tema y animaciones al hacer scroll. |
| \`galeria.html\` | Todas las piezas funcionando. Ábrela en el navegador para ver el estilo. |
${p.tailwind === 4 ? '| `cristal.tailwind.css` | Utilidades de Tailwind v4 con los tokens (bg-superficie, text-texto-2, rounded-cr-grande…). |\n' : ''}${p.tailwind === 3 ? '| `cristal.tailwind3.cjs` | Preset de Tailwind v3 con los tokens. |\n' : ''}
## Conexión

${instruccionesConexion(p, carpeta).join('\n')}

## Personalizar

- Color de marca: pídele al agente "cambia el color de marca a #…".
- Tus propios estilos: usa siempre las variables \`--cr-*\` para que funcionen en claro y oscuro.
`

// ---------- reglas para el agente ----------

const REGLAS = [
  '## Cristal (dsh-cristal)',
  'When you build or change any user interface (screens, pages, components, landing pages), it must look modern, polished and alive, using the Cristal design system:',
  '1. If the project has no .dsh-cristal.json, call cristal_instalar first (pass the brand color if the user gave one) and wire the files exactly as it says. Call cristal_guia once per session before writing UI and follow its principles and pieces.',
  '2. Build with the kit classes (cr-*) and --cr-* variables, combined with Tailwind utilities if the project uses Tailwind. Never hard-code colors; animate only transform/opacity/filter with the kit durations and easings; every interactive element needs hover/pressed feedback; every screen needs loading (skeleton), empty and error states; it must work on a phone and in dark mode.',
  '3. After creating or changing a screen, call cristal_revisar on it (the .html file, or the dev-server URL such as http://localhost:5173/route; start the dev server first if needed). Look at the returned screenshots (desktop light, dark, phone) and fix every high and medium problem, then review again. Do not tell the user it is done before a clean review.',
  '4. Keep the user\'s existing brand and layout decisions; Cristal is the quality bar, not a reason to redesign things they did not ask to change.',
].join('\n')

const deepFreeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v) } return v }
const aviso = (text, summary) => deepFreeze({ role: 'user', id: globalThis.crypto.randomUUID(), content: [{ type: 'text', text }], source: { kind: SOURCE_KIND, form: 'notice', summary: summary.slice(0, 120) } })

export function textoRevision(rev, objetivo, cwd) {
  if (!rev.disponible) return { texto: `⚠️ No pude revisar visualmente: ${rev.motivo}.`, serios: [] }
  const serios = rev.problemas.filter((p) => p.gravedad !== 'baja')
  const leves = rev.problemas.filter((p) => p.gravedad === 'baja')
  const l = []
  if (!serios.length) l.push(`✅ ${objetivo}: sin problemas importantes (escritorio claro, oscuro y celular).`)
  else {
    l.push(`❌ ${objetivo}: ${serios.length} problema(s) por corregir:`)
    serios.slice(0, 16).forEach((p, i) => l.push(`${i + 1}. [${p.gravedad}] ${p.tipo}${p.donde ? ` — ${p.donde}` : ''}: ${p.detalle} (${p.vistas.join(', ')})`))
    if (serios.length > 16) l.push(`… y ${serios.length - 16} más.`)
  }
  if (leves.length) l.push('', 'Detalles para pulir:', ...leves.slice(0, 6).map((p) => `- ${p.tipo}${p.donde ? ` — ${p.donde}` : ''}: ${p.detalle}`))
  const m = rev.medidas ?? {}
  if (m.escritorio) l.push('', `Medidas: ${m.animaciones ?? 0} animaciones al cargar · saltos al cargar ${m.saltos ?? 0} · alto ${m.escritorio.alto} px (escritorio) / ${m.celular?.alto ?? '?'} px (celular)${m.escritorio.conKit ? '' : ' · sin el kit Cristal'}.`)
  if (rev.capturas?.length) l.push(`Capturas (míralas antes de dar por terminada la pantalla): ${rev.capturas.map((c) => path.relative(cwd, c).split(path.sep).join('/')).join(', ')}`)
  return { texto: l.join('\n'), serios }
}

// ---------- plugin ----------

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const estados = new WeakMap()
  const estado = (agent) => { let s = estados.get(agent); if (!s) { s = { editados: new Map(), revisiones: new Map(), ultimaRevision: 0, rondas: 0, revisoEnPedido: false }; estados.set(agent, s) } return s }

  ctx.systemPrompt.section({ name: 'cristal', order: 2475, interpolate: false, text: REGLAS })

  const salida = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }

  ctx.tools.register({
    name: 'cristal_instalar',
    description: 'Instala o actualiza el sistema de diseño Cristal en el proyecto (cristal.css, cristal.js, marca.css con el color de marca, integración con Tailwind si aplica y una galería con todas las piezas). Detecta React/Vite, Vue, Java (Spring) o HTML. Devuelve exactamente qué líneas agregar para conectarlo. Úsala también para cambiar el color de marca.',
    parameters: {
      type: 'object',
      properties: {
        acento: { type: 'string', description: 'Color de marca en hexadecimal, ej. #0b63f6. Si se omite, se conserva el actual o se usa azul.' },
        carpeta: { type: 'string', description: 'Opcional: carpeta destino dentro del proyecto (por defecto se elige según el tipo de proyecto)' },
        nombre: { type: 'string', description: 'Opcional: nombre del producto para la galería' },
      },
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      let previo = null
      try { previo = JSON.parse(await readFile(path.join(cwd, MARCADOR), 'utf8')) } catch {}
      const p = await detectarProyecto(cwd)
      const carpeta = String(args?.carpeta || previo?.carpeta || p.carpeta).replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '')
      if (!carpeta || carpeta.split('/').includes('..') || path.isAbsolute(carpeta)) throw new Error('"carpeta" debe ser una ruta dentro del proyecto')
      const dir = path.join(cwd, carpeta)
      await mkdir(dir, { recursive: true })
      const acento = args?.acento || previo?.acento || cfg.acento
      const marca = paletaMarca(acento)
      const kit = ['cristal.css', 'cristal.js', ...(p.tailwind === 4 ? ['cristal.tailwind.css'] : []), ...(p.tailwind === 3 ? ['cristal.tailwind3.cjs'] : [])]
      for (const f of kit) await copyFile(path.join(AQUI, 'kit', f), path.join(dir, f))
      const marcaExiste = existsSync(path.join(dir, 'marca.css'))
      if (!marcaExiste || args?.acento) await writeFile(path.join(dir, 'marca.css'), cssMarca(marca), 'utf8')
      const nombre = String(args?.nombre || previo?.nombre || path.basename(cwd)).slice(0, 40)
      await writeFile(path.join(dir, 'galeria.html'), galeria({ nombre }), 'utf8')
      await writeFile(path.join(dir, 'LEEME.md'), LEEME(p, carpeta, marca), 'utf8')
      await writeFile(path.join(cwd, MARCADOR), JSON.stringify({ version: VERSION, carpeta, acento: marca.base, tipo: p.tipo, tailwind: p.tailwind, nombre }, null, 2) + '\n', 'utf8')
      const archivos = [...kit, 'marca.css', 'galeria.html', 'LEEME.md'].map((f) => `${carpeta}/${f}`)
      return [
        `${previo ? 'Actualizado' : 'Instalado'} Cristal ${VERSION} en ${carpeta}/ (proyecto ${p.tipo}${p.tailwind ? ` con Tailwind ${p.tailwind}` : ''}). Color de marca: ${marca.base}${marcaExiste && !args?.acento ? ' (se conservó el que ya tenía marca.css)' : ''}.`,
        ...marca.avisos.map((a) => `Ojo: ${a}.`),
        `Archivos: ${archivos.join(', ')}`,
        '',
        previo && previo.carpeta === carpeta ? 'La conexión ya existía; verifica que siga así:' : 'Conéctalo (haz estos cambios ahora):',
        ...instruccionesConexion(p, carpeta),
        '',
        `Galería con todas las piezas: ${carpeta}/galeria.html (el usuario puede abrirla en el navegador). Luego llama cristal_guia.`,
      ].join('\n')
    },
  })

  ctx.tools.register({
    name: 'cristal_guia',
    description: 'Principios de diseño Cristal y catálogo de piezas con su HTML (estructura con barra lateral, encabezado, portada, KPIs, tarjetas, lista agrupada, tabla, formulario, controles, pestañas, hoja, avisos, estados, movimiento y notas para React). Llámala antes de escribir interfaz.',
    parameters: { type: 'object', properties: { pieza: { type: 'string', enum: Object.keys(PIEZAS), description: 'Solo una pieza (opcional)' } } },
    output: salida,
    async execute(args) { return textoGuia(args?.pieza) },
  })

  ctx.tools.register({
    name: 'cristal_revisar',
    description: 'Abre una pantalla en el navegador del computador (sin ventana) y la revisa en escritorio claro, escritorio oscuro y celular: desbordes, texto cortado o encimado, contraste, áreas de toque, errores, animaciones (propiedades, duración, saltos al cargar, "reducir movimiento"). Devuelve los problemas y capturas para mirar. Acepta un archivo .html del proyecto o una URL local (http://localhost:…).',
    timeoutMs: 4 * 60_000,
    parameters: {
      type: 'object',
      properties: {
        objetivo: { type: 'string', description: 'Ruta de un .html del proyecto, o URL del servidor de desarrollo (http://localhost:5173/aprendices)' },
        nombre: { type: 'string', description: 'Nombre corto para las capturas, ej. "aprendices"' },
      },
      required: ['objetivo'],
    },
    output: salida,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      let objetivo = String(args.objetivo ?? '').trim()
      if (!objetivo) throw new Error('"objetivo" está vacío')
      if (!/^https?:\/\//i.test(objetivo)) {
        const full = path.resolve(cwd, objetivo)
        const rel = path.relative(cwd, full)
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('el archivo debe estar dentro del proyecto')
        if (!existsSync(full)) throw new Error(`no existe ${objetivo}`)
        objetivo = full
      } else if (!objetivoValido(objetivo)) throw new Error('solo reviso servidores locales (http://localhost:… o http://127.0.0.1:…)')
      const base = String(args.nombre || (/^https?:/i.test(objetivo) ? new URL(objetivo).pathname : path.basename(objetivo, path.extname(objetivo))) || 'inicio')
        .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'inicio'
      let rev
      try { rev = await revisar(objetivo, { navegador: cfg.navegador, carpetaCapturas: path.join(cwd, cfg.carpetaCapturas), base, signal: exec.signal }) } catch (e) { rev = { disponible: false, motivo: e?.message ?? String(e) } }
      const mostrado = /^https?:/i.test(objetivo) ? objetivo : path.relative(cwd, objetivo).split(path.sep).join('/')
      const r = textoRevision(rev, mostrado, cwd)
      if (exec.agent) {
        const s = estado(exec.agent)
        s.ultimaRevision = Date.now()
        s.revisoEnPedido = true
        if (r.serios.length) s.revisiones.set(mostrado, r.serios); else s.revisiones.delete(mostrado)
      }
      return r.texto
    },
  })

  // Pedido nuevo del usuario: reinicia el control de rondas.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      if (decision?.kind === 'enter' && payload.agent && (decision.messages ?? []).some((m) => m?.source?.kind === 'user')) {
        const s = estado(payload.agent); s.rondas = 0; s.editados.clear(); s.revisoEnPedido = false
      }
    } catch {}
    return decision
  })

  // Anotar qué archivos de interfaz se tocaron y cuándo.
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      if (exec?.agent && MUTA.test(exec.name ?? '')) {
        const a = exec.arguments ?? {}
        const r = a.file_path ?? a.path ?? a.filePath ?? a.file
        if (typeof r === 'string' && UI.test(r) && !/(^|[\\/])cristal[\\/](cristal|marca)\.|galeria\.html$/i.test(r)) estado(exec.agent).editados.set(r.replace(/\\/g, '/'), Date.now())
      }
    } catch {}
    return next()
  })

  // Antes de entregar: ¿se revisó la interfaz que cambió? ¿quedaron problemas?
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const s = estados.get(agent)
    if (!s || s.rondas >= cfg.rondas || signal?.aborted) return
    let instalado = false
    try { instalado = existsSync(path.join(await ctx.workingDirectory.ensure(agent, signal), MARCADOR)) } catch {}
    const sinRevisar = [...s.editados.entries()].filter(([, t]) => t > s.ultimaRevision).map(([f]) => f)
    const pendientes = s.editados.size || s.revisoEnPedido ? [...s.revisiones.entries()] : []
    if (!pendientes.length && !(instalado && sinRevisar.length)) return
    s.rondas++
    const l = ['[Cristal] Antes de entregar:']
    if (sinRevisar.length && instalado) l.push(`- Cambiaste la interfaz (${sinRevisar.slice(0, 6).join(', ')}${sinRevisar.length > 6 ? '…' : ''}) y no la revisaste después. Llama cristal_revisar sobre cada pantalla afectada (archivo .html o la URL del servidor de desarrollo), mira las capturas y corrige.`)
    for (const [obj, ps] of pendientes) l.push(`- ${obj} tenía ${ps.length} problema(s) sin resolver: ${ps.slice(0, 5).map((p) => `${p.tipo}${p.donde ? ` (${p.donde})` : ''}`).join('; ')}${ps.length > 5 ? '…' : ''}. Corrígelos y revisa otra vez.`)
    if (s.rondas >= cfg.rondas) l.push('(Último recordatorio para este pedido: si algo no se puede corregir, explícale al usuario por qué.)')
    agent.steer(aviso(l.join('\n'), 'Cristal: revisar la interfaz antes de entregar'))
  })
}
