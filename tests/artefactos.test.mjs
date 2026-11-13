import { apply, validar, renderizar, resumirDatos, slug } from '../plugins/dsh-artefactos/index.js'
import { RUNTIME } from '../plugins/dsh-artefactos/kit.js'
import { ventas } from './fixtures/artefacto-ventas.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// el motor del navegador es JavaScript válido
new Function(RUNTIME)

// validación
assert.deepEqual(validar(ventas), [])
assert.match(validar({ titulo: 'x', secciones: [{ bloques: [{ tipo: 'formulario', id: 'mal id', campos: [{ id: 'a' }] }] }] }).join(), /sin espacios/)
assert.match(validar({ titulo: 'x', secciones: [{ bloques: [{ tipo: 'formulario', id: 'v', campos: [{ id: 'p', tipo: 'seleccion' }] }] }] }).join(), /necesita "opciones"/)
assert.match(validar({ titulo: 'x', secciones: [{ bloques: [{ tipo: 'grafico', fuente: { de: 'nada' } }] }] }).join(), /no es un formulario ni una tabla/)
assert.match(validar({ titulo: 'x', secciones: [{ bloques: [{ tipo: 'lista', id: 'a' }, { tipo: 'notas', id: 'a' }] }] }).join(), /id repetido/)
assert.match(validar({ titulo: 'x', secciones: [{ bloques: [{ tipo: 'video' }] }] }).join(), /"tipo" debe ser/)

// HTML: escapa, no rompe el <script>, sin recursos externos
const html = renderizar({ ...ventas, titulo: 'Ventas </script><script>alert(1)</script>', color: 'red;}body{' })
assert.ok(!html.includes('</script><script>alert(1)'), 'no se puede inyectar script')
assert.match(html, /Ventas &lt;\/script&gt;/); assert.match(html, /--acento:#2d6cdf/, 'color inválido usa el de defecto')
assert.ok(!/(src|href)=["']https?:/.test(html), 'sin recursos externos')
assert.equal(slug('Control de Ventas — XT Ñ'), 'control-de-ventas-xt-n')

// resumen para el agente
assert.match(resumirDatos(ventas, null), /Todavía no hay datos/)
const r = resumirDatos(ventas, { actualizado: 'hoy', registros: { ventas: [{ cliente: 'Ana | B', total: 1000, _fecha: 'f' }] }, listas: { pendientes: [{ texto: 'Hilo', hecho: true }] }, notas: { notas: 'ojo' }, calculos: { precio: { costo: 5 } } })
assert.match(r, /Formulario "Nueva venta" \(id ventas\): 1 registros/); assert.match(r, /Ana \/ B/); assert.match(r, /\[x\] Hilo/); assert.match(r, /Costo por prenda: 5/)

// herramientas + servidor
const cwd = await mkdtemp(path.join(tmpdir(), 'arte-'))
const tools = {}; const efectos = []
apply({ tools: { register: (t) => { tools[t.name] = t } }, workingDirectory: { ensure: async () => cwd }, effect: (f) => efectos.push(f()) }, { puerto: 0 })
const ex = { agent: {}, signal: new AbortController().signal }
const out = await tools.artefacto_crear.execute({ ...ventas, datosIniciales: { listas: { pendientes: [{ texto: 'precargado', hecho: false }] } } }, ex)
const url = out.match(/http:\/\/\S+\.html/)[0]
assert.match(await readFile(path.join(cwd, 'artefactos/control-ventas.html'), 'utf8'), /Control de ventas XT/)
assert.match(await readFile(path.join(cwd, 'artefactos/control-ventas.datos.json'), 'utf8'), /precargado/)
const pagina = await (await fetch(url)).text(); assert.match(pagina, /__CONEXION__=\{"datos":"\/a\/[a-f0-9]{24}\/control-ventas\/datos"\}/)
const datosUrl = url.replace(/\.html$/, '/datos')
assert.match(await (await fetch(datosUrl)).text(), /precargado/)
const ok = await fetch(datosUrl, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ registros: { ventas: [{ cliente: 'Real', total: 5 }] } }) })
assert.equal(ok.status, 204)
assert.match(await tools.artefacto_leer.execute({ nombre: 'control-ventas' }, ex), /\| 5 \|/)
// otro sitio web no puede escribir
assert.equal((await fetch(datosUrl, { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://malo.com' }, body: '{}' })).status, 403)
assert.equal((await fetch(datosUrl, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415)
assert.equal((await fetch(datosUrl.replace(/\/a\/[a-f0-9]{24}/, '/a/' + '0'.repeat(24)))).status, 404, 'token incorrecto')
assert.equal((await fetch(url.replace('control-ventas', '..%2Fsecreto'))).status, 404)
// recrear conserva los datos
assert.match(await tools.artefacto_crear.execute({ ...ventas, subtitulo: 'v2' }, ex), /Actualicé[\s\S]*se conservan/)
assert.match(await tools.artefacto_leer.execute({ nombre: 'control-ventas' }, ex), /Real/)
assert.match(await tools.artefacto_abrir.execute({}, ex), /Control de ventas XT \(control-ventas\): http/)
await assert.rejects(tools.artefacto_leer.execute({ nombre: 'otro' }, ex), /Hay: control-ventas/)
await assert.rejects(tools.artefacto_crear.execute({ titulo: 'x', secciones: [] }, ex), /falta "secciones"/)
for (const f of efectos) f?.()
console.log('artefactos unit: OK')
