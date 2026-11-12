// Planos de ejemplo: una tienda pequeña con pedidos, inventario y pagos.
export const flujo = {
  tipo: 'flujo', titulo: 'Pedido en la tienda en línea', descripcion: 'Desde que el cliente compra hasta que recibe el paquete.', fuente: 'ejemplo inventado',
  nodos: [
    { id: 'inicio', etiqueta: 'Cliente abre la tienda', tipo: 'inicio', grupo: 'Cliente' },
    { id: 'carrito', etiqueta: 'Agrega productos al carrito', grupo: 'Cliente', ref: 'src/pages/Carrito.tsx' },
    { id: 'stock', etiqueta: '¿Hay inventario suficiente?', tipo: 'decision', grupo: 'Sistema', detalle: 'Compara cantidad pedida con inventario disponible por talla.' },
    { id: 'avisar', etiqueta: 'Avisa que no hay talla y sugiere otra', grupo: 'Sistema' },
    { id: 'pago', etiqueta: 'Paga con PSE o tarjeta', grupo: 'Cliente' },
    { id: 'pasarela', etiqueta: 'Pasarela de pagos (Wompi)', tipo: 'externo', grupo: 'Sistema' },
    { id: 'aprobado', etiqueta: '¿Pago aprobado?', tipo: 'decision', grupo: 'Sistema' },
    { id: 'reservar', etiqueta: 'Descuenta inventario y crea el pedido', grupo: 'Sistema', ref: 'api/pedidos.crear' },
    { id: 'bd', etiqueta: 'Base de datos', tipo: 'dato', grupo: 'Sistema' },
    { id: 'empacar', etiqueta: 'Empaca y genera guía', grupo: 'Bodega' },
    { id: 'whatsapp', etiqueta: 'Avisar por WhatsApp con la guía', grupo: 'Bodega', estado: 'propuesta' },
    { id: 'fin', etiqueta: 'Cliente recibe el paquete', tipo: 'fin', grupo: 'Cliente' },
  ],
  conexiones: [
    { desde: 'inicio', hacia: 'carrito' }, { desde: 'carrito', hacia: 'stock' },
    { desde: 'stock', hacia: 'avisar', etiqueta: 'no' }, { desde: 'avisar', hacia: 'carrito', etiqueta: 'elige otra' },
    { desde: 'stock', hacia: 'pago', etiqueta: 'sí' }, { desde: 'pago', hacia: 'pasarela' }, { desde: 'pasarela', hacia: 'aprobado' },
    { desde: 'aprobado', hacia: 'pago', etiqueta: 'no, reintentar' }, { desde: 'aprobado', hacia: 'reservar', etiqueta: 'sí' },
    { desde: 'reservar', hacia: 'bd', tipo: 'datos' }, { desde: 'reservar', hacia: 'empacar' },
    { desde: 'empacar', hacia: 'whatsapp', tipo: 'opcional' }, { desde: 'empacar', hacia: 'fin' },
  ],
  notas: ['Falta definir qué pasa si el pago queda pendiente más de 30 minutos.'],
}
export const datos = {
  tipo: 'datos', titulo: 'Base de datos de la tienda',
  tablas: [
    { nombre: 'clientes', campos: [{ nombre: 'id', tipo: 'uuid', pk: true }, { nombre: 'nombre', tipo: 'text' }, { nombre: 'telefono', tipo: 'text' }] },
    { nombre: 'productos', campos: [{ nombre: 'id', tipo: 'uuid', pk: true }, { nombre: 'nombre', tipo: 'text' }, { nombre: 'precio', tipo: 'numeric' }] },
    { nombre: 'inventario', campos: [{ nombre: 'id', tipo: 'uuid', pk: true }, { nombre: 'producto_id', tipo: 'uuid', fk: 'productos.id' }, { nombre: 'talla', tipo: 'text' }, { nombre: 'cantidad', tipo: 'int' }] },
    { nombre: 'pedidos', campos: [{ nombre: 'id', tipo: 'uuid', pk: true }, { nombre: 'cliente_id', tipo: 'uuid', fk: 'clientes.id' }, { nombre: 'estado', tipo: 'text' }, { nombre: 'total', tipo: 'numeric' }] },
    { nombre: 'pedido_items', campos: [{ nombre: 'pedido_id', tipo: 'uuid', fk: 'pedidos.id', pk: true }, { nombre: 'inventario_id', tipo: 'uuid', fk: 'inventario.id', pk: true }, { nombre: 'cantidad', tipo: 'int' }] },
    { nombre: 'pagos', estado: 'propuesta', campos: [{ nombre: 'id', tipo: 'uuid', pk: true }, { nombre: 'pedido_id', tipo: 'uuid', fk: 'pedidos.id', cardinalidad: '1:1' }, { nombre: 'referencia_wompi', tipo: 'text' }] },
  ],
}
export const arquitectura = {
  tipo: 'arquitectura', titulo: 'Arquitectura de la tienda', direccion: 'horizontal',
  nodos: [
    { id: 'cliente', etiqueta: 'Cliente (celular)', tipo: 'actor', grupo: 'Usuarios' },
    { id: 'admin', etiqueta: 'Administrador', tipo: 'actor', grupo: 'Usuarios' },
    { id: 'web', etiqueta: 'Tienda web (React)', tipo: 'pantalla', grupo: 'Frontend' },
    { id: 'panel', etiqueta: 'Panel admin', tipo: 'pantalla', grupo: 'Frontend' },
    { id: 'api', etiqueta: 'API (Node/Express)', tipo: 'servicio', grupo: 'Backend' },
    { id: 'db', etiqueta: 'PostgreSQL (Supabase)', tipo: 'dato', grupo: 'Datos' },
    { id: 'wompi', etiqueta: 'Wompi', tipo: 'externo', grupo: 'Externos' },
    { id: 'wa', etiqueta: 'WhatsApp Business', tipo: 'externo', grupo: 'Externos', estado: 'propuesta' },
  ],
  conexiones: [
    { desde: 'cliente', hacia: 'web' }, { desde: 'admin', hacia: 'panel' }, { desde: 'web', hacia: 'api', etiqueta: 'HTTPS' }, { desde: 'panel', hacia: 'api' },
    { desde: 'api', hacia: 'db', etiqueta: 'SQL' }, { desde: 'api', hacia: 'wompi', etiqueta: 'cobros' }, { desde: 'api', hacia: 'wa', tipo: 'opcional' },
  ],
}
