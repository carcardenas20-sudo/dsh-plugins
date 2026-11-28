// CI: lee .prueba/resultado.json y falla si hubo errores o si la página no llegó a Supabase.
const fs = require('node:fs'); const path = require('node:path')
const r = JSON.parse(fs.readFileSync(path.join(process.argv[2], '.prueba', 'resultado.json'), 'utf8'))
console.log(JSON.stringify({ ...r, automatizaciones: (r.automatizaciones || []).map((a) => ({ id: a.id, ok: a.ok, resultado: a.resultado, error: a.error })) }, null, 2))
const malos = [...r.errores]
if (!/"conexion":"en-linea"/.test(r.texto)) malos.push('sin tiempo real con Supabase')
if (!/"config":"servidor/.test(r.texto)) malos.push('no leyó app_config del servidor')
if (!r.puente) malos.push('sin window.escritorio')
if ((r.automatizaciones || []).length !== 2 || r.automatizaciones.some((a) => !a.ok)) malos.push('automatizaciones')
if (malos.length) { console.error('❌ ' + malos.join(' · ')); process.exit(1) }
console.log('✅ todo bien')
