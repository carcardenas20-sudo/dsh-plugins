// dsh-planos — visualizaciones de procesos y plataformas dentro de DeepSeek Harness.
//
// Registra la herramienta `visualizar`: el agente describe la estructura (pasos,
// pantallas, módulos, tablas y sus conexiones) y el plugin la dibuja como un HTML
// autocontenido (SVG, sin internet), lo guarda en planos/ del proyecto y le pide
// al agente entregarlo para que se abra en el panel lateral de dsh.

import { mkdir, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { renderizar, validar, TIPOS, FORMAS } from './render.js'

export const name = 'planos'
export const inject = ['tools', 'workingDirectory']

const DEFAULTS = { carpeta: 'planos' }

export const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'plano'

export function rutaSegura(cwd, archivo) {
  const full = path.resolve(cwd, archivo)
  const rel = path.relative(cwd, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`"archivo" debe quedar dentro del proyecto (recibí: ${archivo})`)
  if (!/\.html?$/i.test(full)) throw new Error('"archivo" debe terminar en .html')
  return { full, rel: rel.split(path.sep).join('/') }
}

const nodoSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Identificador corto y único, por ejemplo "pedido" o "pantalla-login"' },
    etiqueta: { type: 'string', description: 'Texto visible, corto (máximo ~8 palabras)' },
    tipo: { type: 'string', enum: FORMAS, description: 'Forma: inicio, fin, paso, decision, dato (base de datos/archivo), externo (sistema de terceros), pantalla, actor (persona/rol), servicio, nota. Por defecto paso' },
    grupo: { type: 'string', description: 'Carril: responsable o área en un flujo (Ventas, Bodega), capa en arquitectura (Frontend, Backend), módulo en un mapa' },
    detalle: { type: 'string', description: 'Explicación de 1 a 3 frases: qué pasa aquí, reglas, datos que se usan' },
    ref: { type: 'string', description: 'Dónde está en el código, por ejemplo "src/routes/pedidos.js" o "PedidoController.crear"' },
    estado: { type: 'string', enum: ['existe', 'propuesta'], description: '"propuesta" si todavía no existe en el código (se dibuja punteado). Por defecto existe' },
  },
  required: ['id', 'etiqueta'],
}

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}) }

  ctx.tools.register({
    name: 'visualizar',
    description:
      'Dibuja un plano visual (HTML con diagrama) de un proceso o plataforma y lo guarda en el proyecto: ' +
      'flujo (proceso paso a paso con responsables), mapa (módulos y pantallas de la plataforma y cómo se navega), ' +
      'arquitectura (frontend, backend, base de datos, servicios externos), datos (tablas, campos y relaciones) o recorrido (lo que hace un usuario paso a paso). ' +
      'Úsala cuando el usuario pida ver, entender, explicar, documentar o planear cómo funciona algo. ' +
      'Si hay código, LÉELO PRIMERO (rutas, modelos, pantallas, migraciones) y basa el plano en lo que existe; marca con estado "propuesta" lo que aún no existe y pon en "ref" dónde está cada cosa. ' +
      'Para actualizar un plano, vuelve a llamarla con el mismo "archivo". ' +
      'Después de crearlo, llama a la herramienta present con la ruta devuelta y menciónala en tu respuesta entre comillas invertidas para que el usuario la abra.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: Object.keys(TIPOS) },
        titulo: { type: 'string', description: 'Título del plano' },
        descripcion: { type: 'string', description: 'Una o dos frases: qué muestra y para qué sirve' },
        fuente: { type: 'string', description: 'En qué se basa: "código de src/ y prisma/schema.prisma", "lo que contó el usuario", etc.' },
        direccion: { type: 'string', enum: ['vertical', 'horizontal'], description: 'vertical (por defecto, cabe mejor en el panel) u horizontal' },
        nodos: { type: 'array', description: 'Elementos del diagrama (todos los tipos menos "datos"). Máximo 120', items: nodoSchema },
        conexiones: {
          type: 'array',
          description: 'Flechas entre nodos',
          items: {
            type: 'object',
            properties: {
              desde: { type: 'string' }, hacia: { type: 'string' },
              etiqueta: { type: 'string', description: 'Texto corto en la flecha: "sí", "no", "envía factura", "POST /pedidos"' },
              tipo: { type: 'string', enum: ['normal', 'opcional', 'datos'], description: 'opcional = a veces ocurre; datos = flujo de información' },
            },
            required: ['desde', 'hacia'],
          },
        },
        tablas: {
          type: 'array',
          description: 'Solo para tipo "datos"',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string' }, descripcion: { type: 'string' }, grupo: { type: 'string' }, ref: { type: 'string' },
              estado: { type: 'string', enum: ['existe', 'propuesta'] },
              campos: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    nombre: { type: 'string' }, tipo: { type: 'string' }, pk: { type: 'boolean' },
                    fk: { type: 'string', description: 'Tabla (o tabla.campo) a la que apunta' },
                    cardinalidad: { type: 'string', description: 'Por defecto 1:N' }, nota: { type: 'string' },
                  },
                  required: ['nombre'],
                },
              },
            },
            required: ['nombre', 'campos'],
          },
        },
        relaciones: {
          type: 'array',
          description: 'Relaciones extra entre tablas que no salen de un campo fk (por ejemplo muchos a muchos)',
          items: { type: 'object', properties: { desde: { type: 'string' }, hacia: { type: 'string' }, cardinalidad: { type: 'string' } }, required: ['desde', 'hacia'] },
        },
        notas: { type: 'array', items: { type: 'string' }, description: 'Supuestos, dudas o pendientes que el usuario debe revisar' },
        archivo: { type: 'string', description: `Ruta dentro del proyecto. Por defecto ${cfg.carpeta}/<titulo>.html. Usa la misma para actualizar` },
      },
      required: ['tipo', 'titulo'],
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args, exec) {
      const plano = args ?? {}
      const errores = validar(plano)
      if (errores.length) throw new Error(`No pude dibujar el plano:\n- ${errores.join('\n- ')}\nCorrige y vuelve a llamar visualizar.`)
      if (!exec?.agent) throw new Error('visualizar necesita una sesión con proyecto abierto')
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const { full, rel } = rutaSegura(cwd, plano.archivo || path.join(cfg.carpeta, `${slug(plano.titulo)}.html`))
      const html = renderizar(plano)
      await mkdir(path.dirname(full), { recursive: true })
      const tmp = `${full}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, html, 'utf8')
      await rename(tmp, full)
      const cuantos = plano.tipo === 'datos' ? `${plano.tablas.length} tablas` : `${plano.nodos.length} elementos y ${(plano.conexiones ?? []).length} conexiones`
      const propuestas = (plano.tipo === 'datos' ? plano.tablas : plano.nodos).filter((n) => n.estado === 'propuesta').length
      return [
        `Plano guardado en ${rel} (${TIPOS[plano.tipo]}, ${cuantos}${propuestas ? `, ${propuestas} propuestos` : ''}).`,
        `Ahora llama present con files: [{ path: "${rel}", description: "${TIPOS[plano.tipo]}: ${String(plano.titulo).replace(/"/g, "'")}" }] y menciona \`${rel}\` en tu respuesta para que el usuario lo abra en el panel lateral.`,
        'Resume en 2 o 3 frases qué muestra y señala lo marcado como propuesta o en notas.',
      ].join('\n')
    },
  })
}
