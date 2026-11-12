import { apply, _internals } from '../plugins/dsh-rea/index.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('./fixtures/fake-mcp.mjs', import.meta.url))
const tools = {}; const efectos = []
apply({ tools: { register: (t) => { tools[t.name] = t } }, effect: (f) => efectos.push(f()), logger: {} },
  { comando: process.execPath, args: [fixture], timeoutSegundos: 2, maxCaracteres: 1000 })
assert.deepEqual(Object.keys(tools).sort(), ['rea_buscar', 'rea_guia', 'rea_llamar'])
const sig = () => ({ signal: new AbortController().signal })

// buscar: paginación de tools/list, ranking, sinónimos en español
const todas = await tools.rea_buscar.execute({}, sig())
assert.match(todas, /4 herramientas/); assert.match(todas, /slow_tool/)
const js = await tools.rea_buscar.execute({ consulta: 'analizar aplicación javascript' }, sig())
assert.match(js.split('\n\n')[1], /### analyze_javascript_application/); assert.match(js, /"required":\["path"\]/)
assert.match(await tools.rea_buscar.execute({ consulta: 'descompilar función' }, sig()), /### procedure_pseudo_code/)
assert.match(await tools.rea_buscar.execute({ consulta: 'red de una página web' }, sig()), /### capture_website_network/)
assert.match(await tools.rea_buscar.execute({ consulta: 'zzzz' }, sig()), /Ninguna herramienta/)

// llamar
assert.match(await tools.rea_llamar.execute({ herramienta: 'analyze_javascript_application', argumentos: { path: 'C:/app' } }, sig()), /modules of C:\/app: main.js/)
await assert.rejects(tools.rea_llamar.execute({ herramienta: 'procedure_pseudo_code' }, sig()), /respondió con error:\nno provider configured/)
await assert.rejects(tools.rea_llamar.execute({ herramienta: 'analyze_js' }, sig()), /Quizás: analyze_javascript_application/)
assert.match(await tools.rea_llamar.execute({ herramienta: 'capture_website_network' }, sig()), /recortado: 4000 caracteres más/)
await assert.rejects(tools.rea_llamar.execute({ herramienta: 'slow_tool' }, sig()), /no respondió a tiempo/)
const ac = new AbortController(); const p = tools.rea_llamar.execute({ herramienta: 'slow_tool' }, { signal: ac.signal }); ac.abort()
await assert.rejects(p, /cancelado/)
// sigue vivo después de cancelar
assert.match(await tools.rea_llamar.execute({ herramienta: 'analyze_javascript_application', argumentos: { path: 'x' } }, sig()), /modules of x/)

// guía: instrucciones del servidor
assert.match(await tools.rea_guia.execute({}, sig()), /Collect evidence first/)

// comando que no existe: error claro, sin colgarse
{
  const t = {}
  apply({ tools: { register: (x) => { t[x.name] = x } }, logger: {} }, { comando: 'no-existe-rea-xyz', arranqueSegundos: 5 })
  await assert.rejects(t.rea_buscar.execute({}, sig()), /No pude arrancar REA.*no encontré "no-existe-rea-xyz"/s)
}

assert.deepEqual(_internals.terminos('Página Web'), ['pagina', 'web', 'browser', 'page', 'website', 'http'])
for (const f of efectos) f?.()
console.log('rea unit: OK')
