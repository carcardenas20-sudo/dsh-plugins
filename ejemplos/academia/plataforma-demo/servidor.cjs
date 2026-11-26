// Plataforma web de demostración para probar los robots (login, filtro, tabla que carga sola, descarga de CSV).
// node plataforma-demo/servidor.cjs  →  http://127.0.0.1:8890   (usuario: demo · clave: demo123)
const http = require('node:http')
const PUERTO = Number(process.env.PUERTO || 8890)
const PAGOS = [
  ['1023456789', 'Laura Martínez', 'Norte', 980000, 'Al día'], ['79888123', 'Andrés Rojas', 'Centro', 450000, 'Pendiente'],
  ['1010222333', 'Camila Torres', 'Norte', 1250000, 'Al día'], ['1019888777', 'Julián Pérez', 'Sur', 320000, 'Vencido'],
  ['52111444', 'Diana Gómez', 'Centro', 610000, 'Vencido'], ['1032777555', 'Sebastián Díaz', 'Sur', 875000, 'Al día'],
  ['1000333999', 'Valentina Ruiz', 'Norte', 290000, 'Vencido'], ['80123456', 'Felipe Castro', 'Centro', 1100000, 'Al día'],
]
const estilo = `<style>body{font:15px system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#222}label{display:block;margin:12px 0 4px}input,select,button{font:inherit;padding:8px 10px}button{margin-top:14px;cursor:pointer}table{border-collapse:collapse;width:100%;margin-top:18px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}</style>`
const pagina = (cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Plataforma de pagos (demo)</title>${estilo}</head><body>${cuerpo}</body></html>`
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const conSesion = /sesion=ok/.test(req.headers.cookie || '')
  if (req.method === 'POST' && url.pathname === '/entrar') {
    let cuerpo = ''; req.on('data', (c) => (cuerpo += c)); req.on('end', () => {
      const f = new URLSearchParams(cuerpo)
      if (f.get('usuario') === 'demo' && f.get('clave') === 'demo123') { res.writeHead(303, { 'Set-Cookie': 'sesion=ok; Path=/; Max-Age=2592000', Location: '/pagos' }); res.end() }
      else { res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(pagina('<h1>Datos incorrectos</h1><a href="/">Volver</a>')) }
    }); return
  }
  if (url.pathname === '/pagos' && conSesion) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(pagina(`<h1>Pagos por sede</h1><label for="sede">Sede</label><select id="sede"><option>Norte</option><option>Centro</option><option>Sur</option></select>
      <button id="consultar">Consultar</button> <button id="descargar" disabled>Descargar CSV</button><div id="tabla"></div>
      <script>const t=document.getElementById('tabla'),d=document.getElementById('descargar');
      document.getElementById('consultar').onclick=()=>{t.innerHTML='<p>Cargando…</p>';d.disabled=true;setTimeout(async()=>{const filas=await (await fetch('/api/pagos?sede='+sede.value)).json();
      t.innerHTML='<table><tr><th>Documento</th><th>Nombre</th><th>Saldo</th><th>Estado</th></tr>'+filas.map(f=>'<tr><td>'+f.documento+'</td><td>'+f.nombre+'</td><td>'+f.saldo+'</td><td>'+f.estado+'</td></tr>').join('')+'</table>';d.disabled=false},900)};
      d.onclick=()=>{location.href='/pagos.csv?sede='+sede.value}</script>`))
  }
  if (url.pathname.startsWith('/api/pagos') && conSesion) {
    const filas = PAGOS.filter((p) => p[2] === url.searchParams.get('sede')).map(([documento, nombre, , saldo, estado]) => ({ documento, nombre, saldo, estado }))
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(filas))
  }
  if (url.pathname === '/pagos.csv' && conSesion) {
    const s = url.searchParams.get('sede')
    const csv = 'documento,nombre,saldo,estado\n' + PAGOS.filter((p) => p[2] === s).map((p) => [p[0], p[1], p[3], p[4]].join(',')).join('\n') + '\n'
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="pagos-${s.toLowerCase()}.csv"` }); return res.end(csv)
  }
  if (url.pathname.startsWith('/pagos') && !conSesion) { res.writeHead(303, { Location: '/' }); return res.end() }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(pagina(`<h1>Plataforma de pagos (demo)</h1><form method="post" action="/entrar"><label for="u">Usuario</label><input id="u" name="usuario" autocomplete="username"><label for="c">Clave</label><input id="c" name="clave" type="password" autocomplete="current-password"><br><button>Entrar</button></form>`))
}).listen(PUERTO, '127.0.0.1', () => console.log(`Plataforma demo en http://127.0.0.1:${PUERTO}`))
