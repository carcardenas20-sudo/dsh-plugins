// Artefacto de ejemplo: control de ventas y producción de un taller de confección.
export const ventas = {
  nombre: 'control-ventas', titulo: 'Control de ventas XT', subtitulo: 'Ventas, producción y costos del taller', color: '#d4a106',
  descripcion: 'Registra cada venta; los indicadores y gráficos se actualizan solos.',
  secciones: [
    { bloques: [{ tipo: 'kpis', items: [
      { etiqueta: 'Ventas totales', formula: 'suma(ventas.total)', formato: 'dinero', nota: 'Suma de todas las ventas' },
      { etiqueta: 'Prendas vendidas', formula: 'suma(ventas.cantidad)', formato: 'numero' },
      { etiqueta: 'Ventas registradas', formula: 'contar(ventas)', formato: 'numero' },
      { etiqueta: 'Ticket promedio', formula: 'promedio(ventas.total)', formato: 'dinero' },
    ] }] },
    { titulo: 'Registrar', columnas: 2, bloques: [
      { tipo: 'formulario', id: 'ventas', titulo: 'Nueva venta', ancho: true, boton: 'Guardar venta', campos: [
        { id: 'fecha', etiqueta: 'Fecha', tipo: 'fecha', requerido: true },
        { id: 'cliente', etiqueta: 'Cliente', requerido: true },
        { id: 'prenda', etiqueta: 'Prenda', tipo: 'seleccion', opciones: ['Chaqueta jean', 'Camisa', 'Pantalón'], requerido: true },
        { id: 'cantidad', etiqueta: 'Cantidad', tipo: 'numero', total: true, requerido: true },
        { id: 'total', etiqueta: 'Total', tipo: 'dinero', requerido: true },
        { id: 'canal', etiqueta: 'Canal', tipo: 'seleccion', opciones: ['San Victorino', 'WhatsApp', 'Instagram'] },
      ] },
      { tipo: 'grafico', titulo: 'Ventas por prenda', forma: 'barras', formato: 'dinero', fuente: { de: 'ventas', x: 'prenda', y: 'total' } },
      { tipo: 'grafico', titulo: 'Por canal', forma: 'torta', fuente: { de: 'ventas', x: 'canal', agregacion: 'contar' } },
    ] },
    { titulo: 'Producción', columnas: 2, bloques: [
      { tipo: 'tabla', id: 'costos', titulo: 'Costo por lote', ancho: true, columnas: [
        { id: 'insumo', etiqueta: 'Insumo' }, { id: 'cantidad', etiqueta: 'Cantidad', tipo: 'numero' },
        { id: 'precio', etiqueta: 'Precio unitario', tipo: 'dinero' }, { id: 'subtotal', etiqueta: 'Subtotal', tipo: 'dinero', formula: 'cantidad * precio', total: true } ],
        filas: [['Tela jean (m)', 30, 18000], ['Botones', 200, 150]] },
      { tipo: 'calculadora', id: 'precio', titulo: 'Precio de venta', entradas: [
        { id: 'costo', etiqueta: 'Costo por prenda', tipo: 'dinero', valor: 45000 }, { id: 'margen', etiqueta: 'Margen %', tipo: 'porcentaje', valor: 40 } ],
        resultados: [{ id: 'sin_iva', etiqueta: 'Precio sin IVA', formula: 'costo / (1 - margen/100)', formato: 'dinero' }, { etiqueta: 'Con IVA 19%', formula: 'sin_iva * 1.19', formato: 'dinero' }] },
      { tipo: 'lista', id: 'pendientes', titulo: 'Pendientes del taller', items: ['Comprar hilo', 'Revisar máquina 3'] },
    ] },
    { bloques: [{ tipo: 'notas', id: 'notas', titulo: 'Notas', ancho: true }, { tipo: 'texto', titulo: 'Cómo usarlo', contenido: '- Registra cada venta.\n- Los **indicadores** se recalculan solos.' }] },
  ],
}
