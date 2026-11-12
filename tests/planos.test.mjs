import { apply, rutaSegura, slug } from '../plugins/dsh-planos/index.js'
import { renderizar, validar, disponer } from '../plugins/dsh-planos/render.js'
import * as ej from './fixtures/planos-tienda.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// validación
assert.deepEqual(validar(ej.flujo), []); assert.deepEqual(validar(ej.datos), []); assert.deepEqual(validar(ej.arquitectura), [])
assert.match(validar({ tipo: 'flujo', titulo: 'x', nodos: [{ id: 'a' }], conexiones: [{ desde: 'a', hacia: 'b' }] }).join(), /no existe: b/)
assert.match(validar({ tipo: 'datos', titulo: 'x', tablas: [{ nombre: 't', campos: [{ nombre: 'u', fk: 'nada.id' }] }] }).join(), /tabla que no existe/)
assert.match(validar({ tipo: 'otro', titulo: 'x' }).join(), /"tipo" debe ser/)

// disposición: capas en orden, ciclo detectado, sin solapes dentro de cada capa
const lay = disponer(ej.flujo.nodos.map((n) => ({ id: n.id, w: 190, h: 60, grupo: n.grupo })), ej.flujo.conexiones)
const i = (id) => ej.flujo.nodos.findIndex((n) => n.id === id)
assert.ok(lay.capa[i('inicio')] < lay.capa[i('carrito')] && lay.capa[i('carrito')] < lay.capa[i('stock')] && lay.capa[i('reservar')] < lay.capa[i('fin')])
assert.ok(lay.atras.size >= 1, 'detecta el regreso al carrito')
assert.equal(lay.carriles.length, 3)
for (let a = 0; a < lay.pos.length; a++) for (let b = a + 1; b < lay.pos.length; b++) {
  const sola = Math.abs(lay.pos[a].x - lay.pos[b].x) < 190 && Math.abs(lay.pos[a].y - lay.pos[b].y) < 60
  assert.ok(!sola, `nodos ${a} y ${b} se solapan`)
}

// HTML: autocontenido, escapado, sin recursos externos
const html = renderizar({ ...ej.flujo, titulo: 'Pedido <script>alert(1)</script>' })
assert.ok(!/<script>alert/.test(html)); assert.match(html, /Pedido &lt;script&gt;/)
assert.ok(!/(src|href)=["']https?:/.test(html), 'sin recursos externos')
assert.match(html, /PROPUESTA/); assert.match(html, /<details id="d-whatsapp">/); assert.match(html, /Falta definir/)
assert.match(renderizar(ej.datos), /PK<\/text>/)
assert.match(renderizar(ej.arquitectura), /USUARIOS/)

// rutas
assert.equal(slug('Flujo de Pedidos — Bodega Ñ'), 'flujo-de-pedidos-bodega-n')
assert.throws(() => rutaSegura('/p', '../fuera.html'), /dentro del proyecto/)
assert.throws(() => rutaSegura('/p', 'planos/x.txt'), /\.html/)

// herramienta
const cwd = await mkdtemp(path.join(tmpdir(), 'planos-'))
const tools = {}
apply({ tools: { register: (t) => { tools[t.name] = t } }, workingDirectory: { ensure: async () => cwd } }, {})
const exec = { agent: {}, signal: new AbortController().signal }
const r = await tools.visualizar.execute(ej.flujo, exec)
assert.match(r, /Plano guardado en planos\/pedido-en-la-tienda-en-linea\.html/); assert.match(r, /present/); assert.match(r, /1 propuestos/)
assert.match(await readFile(path.join(cwd, 'planos/pedido-en-la-tienda-en-linea.html'), 'utf8'), /<svg/)
await tools.visualizar.execute({ ...ej.datos, archivo: 'docs/bd.html' }, exec)
assert.match(await readFile(path.join(cwd, 'docs/bd.html'), 'utf8'), /pedido_items/)
await assert.rejects(tools.visualizar.execute({ tipo: 'flujo', titulo: 'x', nodos: [] }, exec), /necesita "nodos"/)
console.log('planos unit: OK')
