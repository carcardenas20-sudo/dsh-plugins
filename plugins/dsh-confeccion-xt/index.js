// dsh-confeccion-xt — herramientas de costos y precios para confección.
// Plugin de DeepSeek Harness sin dependencias: registra tres herramientas
// que el agente puede llamar cuando le hablas de costos, precios o lotes.

export const name = 'confeccion-xt'
export const inject = ['tools']

// ---------- utilidades ----------

const pesos = (n) =>
  '$' + Math.round(n).toLocaleString('es-CO', { maximumFractionDigits: 0 })

const pct = (n) => `${Number(n.toFixed(2))}%`

/** Convierte a número y falla con un mensaje claro si no se puede. */
function num(valor, campo, { min = 0, max = Infinity } = {}) {
  let n = Number(valor)
  if (typeof valor === 'string') {
    // Acepta "$85.000", "85000" o "1,6": quita $ y espacios, el punto de miles y usa coma decimal.
    let t = valor.replace(/[$\s]/g, '')
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '')
    n = Number(t.replace(',', '.'))
  }
  if (!Number.isFinite(n)) throw new Error(`"${campo}" debe ser un número (recibí: ${JSON.stringify(valor)})`)
  if (n < min || n > max) throw new Error(`"${campo}" debe estar entre ${min} y ${max} (recibí: ${n})`)
  return n
}

const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

// ---------- 1. costo de una prenda ----------

const costoPrenda = {
  name: 'costo_prenda',
  description:
    'Calcula el costo unitario de una prenda de confección a partir de sus materiales ' +
    '(tela, insumos), sus operaciones de mano de obra (corte, confección, estampado, terminación) ' +
    'y un porcentaje de costos indirectos. Úsala cuando el usuario pregunte cuánto cuesta producir una prenda.',
  parameters: {
    type: 'object',
    properties: {
      prenda: { type: 'string', description: 'Nombre de la prenda, por ejemplo "chaqueta jean talla M"' },
      materiales: {
        type: 'array',
        description: 'Materiales por unidad: tela, cremallera, botones, hilo, etiquetas, empaque',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            nombre: { type: 'string' },
            cantidad: { type: 'number', description: 'Cantidad por prenda (metros, unidades, etc.)' },
            costo_unitario: { type: 'number', description: 'Costo en pesos por unidad de medida' },
          },
          required: ['nombre', 'cantidad', 'costo_unitario'],
        },
      },
      operaciones: {
        type: 'array',
        description: 'Mano de obra por prenda: corte, confección, estampado, terminación',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            nombre: { type: 'string' },
            costo: { type: 'number', description: 'Pago por prenda en pesos' },
          },
          required: ['nombre', 'costo'],
        },
      },
      indirectos_pct: {
        type: 'number',
        description: 'Porcentaje de costos indirectos (arriendo, energía, transporte) sobre materiales + mano de obra. Por defecto 10',
      },
    },
    required: ['prenda', 'materiales', 'operaciones'],
  },
  output: textOutput,
  async execute(args) {
    const indPct = args.indirectos_pct === undefined ? 10 : num(args.indirectos_pct, 'indirectos_pct', { max: 300 })
    const lineas = []
    let materiales = 0
    for (const m of args.materiales ?? []) {
      const sub = num(m.cantidad, `cantidad de ${m.nombre}`) * num(m.costo_unitario, `costo de ${m.nombre}`)
      materiales += sub
      lineas.push(`  • ${m.nombre}: ${m.cantidad} × ${pesos(m.costo_unitario)} = ${pesos(sub)}`)
    }
    let manoObra = 0
    const ops = []
    for (const o of args.operaciones ?? []) {
      const c = num(o.costo, `costo de ${o.nombre}`)
      manoObra += c
      ops.push(`  • ${o.nombre}: ${pesos(c)}`)
    }
    const directo = materiales + manoObra
    const indirectos = directo * indPct / 100
    const total = directo + indirectos
    return [
      `Costo de ${args.prenda}`,
      'Materiales:', ...lineas, `  Subtotal materiales: ${pesos(materiales)}`,
      'Mano de obra:', ...ops, `  Subtotal mano de obra: ${pesos(manoObra)}`,
      `Indirectos (${pct(indPct)}): ${pesos(indirectos)}`,
      `COSTO UNITARIO: ${pesos(total)}`,
      `Composición: materiales ${pct(materiales / total * 100)}, mano de obra ${pct(manoObra / total * 100)}, indirectos ${pct(indirectos / total * 100)}`,
    ].join('\n')
  },
}

// ---------- 2. precio de venta ----------

const precioVenta = {
  name: 'precio_venta',
  description:
    'Calcula el precio de venta de una prenda a partir de su costo y el margen deseado sobre el precio, ' +
    'para mayorista y detal, con IVA (19% por defecto en Colombia). Úsala cuando el usuario pregunte a cuánto vender.',
  parameters: {
    type: 'object',
    properties: {
      costo: { type: 'number', description: 'Costo unitario en pesos' },
      margen_mayor_pct: { type: 'number', description: 'Margen sobre el precio para venta al por mayor. Por defecto 30' },
      margen_detal_pct: { type: 'number', description: 'Margen sobre el precio para venta al detal. Por defecto 50' },
      iva_pct: { type: 'number', description: 'IVA en porcentaje. Por defecto 19. Usa 0 si no aplica' },
    },
    required: ['costo'],
  },
  output: textOutput,
  async execute(args) {
    const costo = num(args.costo, 'costo', { min: 1 })
    const iva = args.iva_pct === undefined ? 19 : num(args.iva_pct, 'iva_pct', { max: 100 })
    const canal = (nombre, margen) => {
      const m = num(margen, `margen ${nombre}`, { max: 95 })
      const base = costo / (1 - m / 100)
      const conIva = base * (1 + iva / 100)
      return `${nombre} (margen ${pct(m)}): sin IVA ${pesos(base)} | IVA ${pesos(conIva - base)} | precio final ${pesos(conIva)} | ganancia por unidad ${pesos(base - costo)}`
    }
    return [
      `Costo: ${pesos(costo)}`,
      canal('Mayorista', args.margen_mayor_pct ?? 30),
      canal('Detal', args.margen_detal_pct ?? 50),
      'Nota: el margen es sobre el precio de venta, no sobre el costo (30% de margen = costo ÷ 0,70).',
    ].join('\n')
  },
}

// ---------- 3. rentabilidad de un lote ----------

const rentabilidadLote = {
  name: 'rentabilidad_lote',
  description:
    'Calcula ingresos, costos, utilidad y punto de equilibrio de un lote de producción, ' +
    'incluyendo costos fijos del lote (moldes, transporte, publicidad). Úsala para decidir si un lote vale la pena.',
  parameters: {
    type: 'object',
    properties: {
      unidades: { type: 'number', description: 'Prendas producidas en el lote' },
      costo_unitario: { type: 'number', description: 'Costo por prenda en pesos' },
      precio_venta: { type: 'number', description: 'Precio de venta por prenda sin IVA' },
      costos_fijos: { type: 'number', description: 'Costos fijos del lote en pesos. Por defecto 0' },
      vendidas_pct: { type: 'number', description: 'Porcentaje del lote que se espera vender. Por defecto 100' },
    },
    required: ['unidades', 'costo_unitario', 'precio_venta'],
  },
  output: textOutput,
  async execute(args) {
    const u = num(args.unidades, 'unidades', { min: 1 })
    const cu = num(args.costo_unitario, 'costo_unitario')
    const pv = num(args.precio_venta, 'precio_venta', { min: 1 })
    const fijos = args.costos_fijos === undefined ? 0 : num(args.costos_fijos, 'costos_fijos')
    const vendPct = args.vendidas_pct === undefined ? 100 : num(args.vendidas_pct, 'vendidas_pct', { max: 100 })
    const vendidas = Math.floor(u * vendPct / 100)
    const ingresos = vendidas * pv
    const costos = u * cu + fijos
    const utilidad = ingresos - costos
    const contribucion = pv - cu
    const lineas = [
      `Lote de ${u} prendas, se venden ${vendidas} (${pct(vendPct)})`,
      `Ingresos: ${pesos(ingresos)}`,
      `Costos: ${pesos(costos)} (producción ${pesos(u * cu)} + fijos ${pesos(fijos)})`,
      `UTILIDAD: ${pesos(utilidad)}${ingresos > 0 ? ` (margen neto ${pct(utilidad / ingresos * 100)})` : ''}`,
    ]
    if (contribucion <= 0) {
      lineas.push('Alerta: el precio no cubre el costo unitario; cada prenda vendida pierde plata.')
    } else {
      // Toda la producción se paga; la equilibrio es cuántas hay que vender para recuperar costos.
      const equilibrio = Math.ceil(costos / pv)
      lineas.push(
        equilibrio <= u
          ? `Punto de equilibrio: vender ${equilibrio} de ${u} prendas (${pct(equilibrio / u * 100)} del lote)`
          : `Punto de equilibrio: harían falta ${equilibrio} prendas vendidas, más de las ${u} producidas. Sube el precio o baja costos.`,
      )
    }
    return lineas.join('\n')
  },
}

// ---------- registro ----------

export function apply(ctx) {
  // Se registran dentro de apply para que dsh las quite solas al desinstalar.
  ctx.tools.register(costoPrenda)
  ctx.tools.register(precioVenta)
  ctx.tools.register(rentabilidadLote)
}

// Exportadas solo para las pruebas.
export const _tools = { costoPrenda, precioVenta, rentabilidadLote }
