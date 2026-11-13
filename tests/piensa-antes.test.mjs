import { apply, esGrande, planMarkdown } from '../plugins/dsh-piensa-antes/index.js'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ¿grande o pequeño?
for (const t of ['Implementa el módulo de facturación', 'crea un CRUD de clientes con Spring Boot', 'integra la pasarela de pagos Wompi', 'refactoriza el servicio de inventario', 'cambia el esquema de la base de datos para multi-tenant', 'hazlo desde cero', 'arma un dashboard de ventas', 'agrega autenticación con roles']) assert.ok(esGrande(t), t)
for (const t of ['cambia el color del botón', 'corrige la tilde en el título', 'qué hace esta función?', 'implementa esto rápido sin plan', '']) assert.ok(!esGrande(t), t)
assert.ok(esGrande('x '.repeat(300)), 'pedido muy largo')
assert.ok(esGrande('ajusta el header, con plan'))

const cwd = await mkdtemp(path.join(tmpdir(), 'pa-'))
const mk = (config = {}) => {
  const h = {}; const tools = {}; let guard; const secciones = []; const llamadas = []
  const llm = { stream: (o) => { llamadas.push(o); return (async function* () { yield { type: 'text-delta', text: '- Falta migrar los datos existentes antes de cambiar la columna.' }; yield { type: 'finish', reason: { kind: 'stop' } } })() } }
  apply({ on: (e, f) => { h[e] = f }, tools: { register: (t) => { tools[t.name] = t }, guard: (g) => { guard = g } }, llm, workingDirectory: { ensure: async () => cwd }, systemPrompt: { section: (s) => secciones.push(s) } }, config)
  return { h, tools, guard: (e) => guard(e), secciones, llamadas }
}
const agent = { session: { id: 's' }, model: { current: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) } }
const usuario = (x, t) => x.h['agent/pre-step']({ agent, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: t }] }] }))
const plan = { objetivo: 'Facturación electrónica', pasos: [{ paso: 'Crear tabla facturas', archivos: ['db/migraciones/003.sql'] }, { paso: 'Servicio de facturas', archivos: ['src/FacturaService.java'] }], riesgos: ['Facturas duplicadas'], alternativas: ['Usar un proveedor externo'], pruebas: ['mvn test'] }
const ex = { agent, signal: new AbortController().signal }

// tarea grande: bloquea editar hasta que haya plan; leer sí
{
  const x = mk()
  assert.match(x.secciones[0].text, /plan_crear/)
  await usuario(x, 'Implementa el módulo de facturación electrónica')
  assert.match(x.guard({ agent, name: 'write', arguments: {} }), /tarea grande/)
  assert.equal(x.guard({ agent, name: 'read', arguments: {} }), undefined)
  await assert.rejects(x.tools.plan_crear.execute({ objetivo: 'x', pasos: [{ paso: 'a' }] }, ex), /riesgos[\s\S]*pruebas/)
  const r = await x.tools.plan_crear.execute(plan, ex)
  assert.match(r, /Plan registrado en \.dsh-planes\/.*facturacion-electronica\.md: 2 pasos/); assert.match(r, /Falta migrar los datos/); assert.match(r, /Ya puedes editar/)
  assert.equal(x.llamadas.length, 1); assert.equal(x.llamadas[0].model, 'deepseek-v4-pro'); assert.match(x.llamadas[0].messages[0].content[0].text, /PEDIDO DEL USUARIO[\s\S]*facturación electrónica[\s\S]*FacturaService\.java/)
  assert.equal(x.guard({ agent, name: 'write', arguments: {} }), undefined, 'con plan, ya edita')
  await x.tools.plan_crear.execute({ ...plan, objetivo: 'Facturación v2' }, ex)
  assert.equal(x.llamadas.length, 1, 'una sola revisión por pedido')
  const md = await readFile(path.join(cwd, '.dsh-planes', (await readdir(path.join(cwd, '.dsh-planes'))).sort()[0]), 'utf8')
  assert.match(md, /# Plan: Facturación[\s\S]*1\. Crear tabla facturas — `db\/migraciones\/003\.sql`[\s\S]*## Riesgos\n- Facturas duplicadas/)
  // nuevo pedido pequeño: sin bloqueo
  await usuario(x, 'cambia el color del botón de pagar')
  assert.equal(x.guard({ agent, name: 'edit', arguments: {} }), undefined)
}

// con aprobación: espera el "dale" del usuario
{
  const x = mk({ esperarAprobacion: true, revisarPlan: false })
  await usuario(x, 'integra la pasarela de pagos wompi')
  const r = await x.tools.plan_crear.execute(plan, ex)
  assert.match(r, /PREGÚNTALE/); assert.equal(x.llamadas.length, 0)
  assert.match(x.guard({ agent, name: 'write', arguments: {} }), /visto bueno/)
  await usuario(x, 'no, mejor primero el webhook')
  assert.match(x.guard({ agent, name: 'write', arguments: {} }) ?? '', /visto bueno|tarea grande/)
  await usuario(x, 'dale, adelante')
  assert.equal(x.guard({ agent, name: 'write', arguments: {} }), undefined)
}
assert.match(planMarkdown(plan, 'p'), /## Cómo se va a probar\n- mvn test/)
console.log('piensa-antes unit: OK')
