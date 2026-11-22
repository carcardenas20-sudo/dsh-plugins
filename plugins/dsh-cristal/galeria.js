// Galería de dsh-cristal: una página que muestra todas las piezas del kit funcionando,
// con el color de marca del proyecto. Sirve para ver el estilo y como referencia de código.

const I = {
  inicio: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  personas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.6c2.3.3 3.9 1.9 4.5 5.4"/>',
  calendario: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  tarjeta: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/>',
  grafico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  escudo: '<path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  rayo: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  luna: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  bandeja: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
}
const ico = (n, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${I[n]}</svg>`
export { ico as icono }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function galeria({ nombre = 'Proyecto', css = '<link rel="stylesheet" href="./cristal.css"><link rel="stylesheet" href="./marca.css">', js = '<script src="./cristal.js" defer></script>' } = {}) {
  const filas = [
    ['Laura Martínez', 'Curso B1 · Sede Norte', 'Al día', 'ok', '$ 980.000'],
    ['Andrés Rojas', 'Curso A2 · Sede Centro', 'Pendiente', 'aviso', '$ 450.000'],
    ['Camila Torres', 'Curso C1 · Sede Norte', 'Al día', 'ok', '$ 1.250.000'],
    ['Julián Pérez', 'Curso B1 · Sede Sur', 'Vencido', 'error', '$ 320.000'],
  ]
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="dsh-cristal">
<title>Cristal · ${esc(nombre)}</title>
${css}
<style>
.g-codigo { font: 12.5px/1.5 var(--cr-mono); color: var(--cr-texto-3); }
.g-muestras { display: flex; flex-wrap: wrap; gap: var(--cr-e3); }
.g-muestra { display: grid; gap: 6px; font-size: var(--cr-t-chico); color: var(--cr-texto-2); }
.g-muestra i { width: 64px; height: 44px; border-radius: var(--cr-r); border: 1px solid var(--cr-borde); display: block; }
.g-tipos { display: grid; gap: var(--cr-e3); }
.g-tipos small { color: var(--cr-texto-3); font-size: var(--cr-t-mini); display: block; }
</style>
</head>
<body>
<div class="cr-app">
  <aside class="cr-lateral" aria-label="Menú">
    <div class="cr-marca"><i></i>${esc(nombre)}</div>
    <a class="cr-menu-item" href="#resumen" aria-current="page">${ico('inicio')}Resumen</a>
    <a class="cr-menu-item" href="#aprendices">${ico('personas')}Aprendices</a>
    <a class="cr-menu-item" href="#formulario">${ico('calendario')}Agenda</a>
    <a class="cr-menu-item" href="#estados">${ico('tarjeta')}Pagos</a>
    <div class="cr-menu-titulo">Sistema</div>
    <a class="cr-menu-item" href="#base">${ico('grafico')}Fundamentos</a>
    <a class="cr-menu-item" href="#formulario">${ico('ajustes')}Ajustes</a>
  </aside>
  <div class="cr-principal">
    <header class="cr-barra">
      <button class="cr-boton icono fantasma cr-solo-celular" data-cr-menu aria-label="Abrir menú">${ico('menu')}</button>
      <span class="cr-barra-titulo">Galería Cristal</span>
      <span class="cr-espacio"></span>
      <div class="cr-buscador cr-solo-escritorio" style="width:240px"><input class="cr-input" type="search" placeholder="Buscar" aria-label="Buscar"></div>
      <button class="cr-boton icono" data-cr-tema aria-label="Cambiar entre claro y oscuro" title="Claro / oscuro">${ico('luna')}</button>
      <button class="cr-boton primario chico" data-cr-abrir="hoja-nuevo">${ico('mas')}Nuevo</button>
    </header>

    <main class="cr-pagina">
      <section class="cr-heroe cr-entra" style="padding-block:48px 8px">
        <span class="cr-chip info sin-punto">Sistema de diseño · dsh-cristal</span>
        <h1>Claro. Rápido. <span class="cr-degradado">Con vida.</span></h1>
        <p>Cada pieza de esta página es parte del kit. Cambia de tema, abre la hoja, guarda el formulario vacío y desliza.</p>
        <div class="cr-fila-flex" style="justify-content:center">
          <button class="cr-boton primario grande" data-cr-abrir="hoja-nuevo">Abrir una hoja</button>
          <button class="cr-boton fantasma grande" onclick="cristal.aviso('Cambios guardados', { tipo: 'ok', accion: 'Deshacer', alAccion: function(){ cristal.aviso('Se deshizo el cambio') } })">Mostrar un aviso</button>
        </div>
      </section>

      <section class="cr-seccion" id="resumen">
        <div class="cr-encabezado"><div><p class="cr-antetitulo">Resumen</p><h2>Hoy en la sede</h2><p>Cifras que se leen de un vistazo: grandes, tabulares y con su tendencia.</p></div>
          <div class="cr-segmentado" role="radiogroup" aria-label="Periodo">
            <label><input type="radio" name="periodo" checked>Hoy</label><label><input type="radio" name="periodo">Semana</label><label><input type="radio" name="periodo">Mes</label>
          </div></div>
        <div class="cr-rejilla cr-escalonado" style="--min:150px">
          <div class="cr-kpi"><span class="etiqueta">Aprendices activos</span><span class="valor">1.284</span><span class="cambio sube">▲ 6,2 % vs. mes pasado</span></div>
          <div class="cr-kpi"><span class="etiqueta">Clases hoy</span><span class="valor">96</span><span class="cambio sube">▲ 12 más que ayer</span></div>
          <div class="cr-kpi"><span class="etiqueta">Recaudo del mes</span><span class="valor">$ 84,6 M</span><span class="cambio baja">▼ 3,1 % vs. meta</span></div>
          <div class="cr-kpi"><span class="etiqueta">Asistencia</span><span class="valor">94 %</span><div class="cr-progreso" style="--valor:94%"><i></i></div></div>
        </div>
      </section>

      <section class="cr-seccion cr-revela">
        <div class="cr-seccion-cab"><h2>Accesos rápidos</h2><a class="cr-boton fantasma chico" href="#estados">Ver todo</a></div>
        <div class="cr-rejilla" style="--min:240px">
          <a class="cr-tarjeta interactiva" href="#formulario" style="color:inherit;text-decoration:none"><div class="cr-icono">${ico('calendario')}</div><h3>Agendar clase</h3><p class="desc">Elige aprendiz, instructor y vehículo en tres pasos.</p></a>
          <a class="cr-tarjeta interactiva" href="#estados" style="color:inherit;text-decoration:none"><div class="cr-icono">${ico('tarjeta')}</div><h3>Registrar pago</h3><p class="desc">Abonos, saldos y comprobante al instante.</p></a>
          <a class="cr-tarjeta interactiva" href="#aprendices" style="color:inherit;text-decoration:none"><div class="cr-icono">${ico('escudo')}</div><h3>Verificar identidad</h3><p class="desc">Biometría del aprendiz antes de la práctica.</p></a>
        </div>
      </section>

      <section class="cr-seccion cr-revela" id="aprendices">
        <h2>Listas y tablas</h2>
        <div class="cr-rejilla" style="--min:320px;align-items:start">
          <div>
            <p class="cr-lista-titulo">Próximas clases</p>
            <div class="cr-lista">
              <a class="cr-fila" href="#aprendices"><span class="cr-avatar">LM</span><span class="texto"><strong>Laura Martínez</strong><small>Práctica · Vehículo 12</small></span><span class="detalle">7:30</span></a>
              <a class="cr-fila" href="#aprendices"><span class="cr-avatar">AR</span><span class="texto"><strong>Andrés Rojas</strong><small>Teoría · Aula 2</small></span><span class="detalle">9:00</span></a>
              <a class="cr-fila" href="#aprendices"><span class="cr-avatar">CT</span><span class="texto"><strong>Camila Torres</strong><small>Práctica · Vehículo 4</small></span><span class="detalle">10:30</span></a>
            </div>
          </div>
          <div>
            <p class="cr-lista-titulo">Preferencias</p>
            <div class="cr-lista">
              <label class="cr-fila cr-interruptor" style="cursor:pointer"><span class="cr-icono-fila" style="background:#ff9f0a">${ico('rayo')}</span><span class="texto"><strong>Recordatorios por WhatsApp</strong></span><input type="checkbox" checked></label>
              <label class="cr-fila cr-interruptor" style="cursor:pointer"><span class="cr-icono-fila" style="background:#30b158">${ico('escudo')}</span><span class="texto"><strong>Exigir biometría</strong></span><input type="checkbox"></label>
              <button class="cr-fila navega" type="button" onclick="cristal.aviso('Abrirías los ajustes de sedes')"><span class="cr-icono-fila">${ico('ajustes')}</span><span class="texto"><strong>Sedes</strong></span><span class="detalle">3</span></button>
            </div>
          </div>
        </div>
        <div class="cr-tabla-caja">
          <table class="cr-tabla">
            <thead><tr><th>Aprendiz</th><th>Curso y sede</th><th>Estado</th><th class="num">Saldo</th></tr></thead>
            <tbody>${filas.map(([n, c, e, t, s]) => `<tr><td class="principal">${n}</td><td>${c}</td><td><span class="cr-chip ${t}">${e}</span></td><td class="num">${s}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </section>

      <section class="cr-seccion cr-revela" id="formulario">
        <h2>Formularios</h2>
        <div class="cr-tarjeta">
          <form class="cr-formulario" id="g-form" novalidate>
            <div class="cr-rejilla">
              <div class="cr-campo"><label for="g-nombre">Nombre completo</label><input class="cr-input" id="g-nombre" placeholder="Como aparece en el documento" required><span class="error">Escribe el nombre del aprendiz.</span></div>
              <div class="cr-campo"><label for="g-doc">Documento</label><input class="cr-input" id="g-doc" inputmode="numeric" placeholder="1.023.456.789"><span class="ayuda">Sin puntos ni espacios.</span></div>
              <div class="cr-campo"><label for="g-curso">Curso</label><select class="cr-select" id="g-curso"><option>A2 — Motocicleta</option><option>B1 — Automóvil</option><option>C1 — Servicio público</option></select></div>
              <div class="cr-campo"><label for="g-sede">Sede</label><select class="cr-select" id="g-sede"><option>Norte</option><option>Centro</option><option>Sur</option></select></div>
            </div>
            <div class="cr-campo"><label for="g-notas">Observaciones</label><textarea class="cr-area" id="g-notas" placeholder="Opcional"></textarea></div>
            <label class="cr-interruptor"><input type="checkbox" checked> Enviar bienvenida por correo</label>
            <div class="cr-acciones"><button class="cr-boton" type="reset">Limpiar</button><button class="cr-boton primario" type="submit">Guardar aprendiz</button></div>
          </form>
        </div>
      </section>

      <section class="cr-seccion cr-revela" id="estados">
        <h2>Estados</h2>
        <div class="cr-pestanas">
          <div class="cr-pestanas-lista"><button aria-controls="g-p1" aria-selected="true">Vacío</button><button aria-controls="g-p2">Cargando</button><button aria-controls="g-p3">Alertas</button></div>
          <div role="tabpanel" id="g-p1"><div class="cr-tarjeta plana cr-vacio"><div class="cr-icono">${ico('bandeja')}</div><h3>Aún no hay pagos este mes</h3><p>Cuando registres el primero aparecerá aquí con su comprobante.</p><button class="cr-boton primario" onclick="cristal.aviso('Abrirías el registro de pago')">Registrar pago</button></div></div>
          <div role="tabpanel" id="g-p2" hidden><div class="cr-tarjeta cr-pila"><div class="cr-esqueleto" style="width:40%;height:22px"></div><div class="cr-esqueleto" style="width:90%"></div><div class="cr-esqueleto" style="width:75%"></div><div class="cr-fila-flex"><div class="cr-cargando" role="progressbar" aria-label="Cargando"></div><span style="color:var(--cr-texto-2);font-size:var(--cr-t-base)">Cargando pagos…</span></div></div></div>
          <div role="tabpanel" id="g-p3" hidden><div class="cr-pila"><div class="cr-alerta ok"><div><strong>Pago registrado</strong>El comprobante se envió al correo del aprendiz.</div></div><div class="cr-alerta aviso"><div><strong>Examen médico por vencer</strong>Vence en 5 días; agenda la renovación.</div></div><div class="cr-alerta error"><div><strong>No se pudo conectar con el biometrador</strong>Revisa la red del puesto y vuelve a intentar.</div></div></div></div>
        </div>
      </section>

      <section class="cr-seccion cr-revela" id="base">
        <h2>Fundamentos</h2>
        <div class="cr-rejilla" style="--min:300px;align-items:start">
          <div class="cr-tarjeta g-tipos"><h1 style="font-size:40px">Título grande <small>48 · 700</small></h1><h2>Título de sección <small>28 · 700</small></h2><h3>Subtítulo <small>20 · 600</small></h3><p>Texto de lectura a 17 px con interlineado amplio para que se lea sin esfuerzo. <small>17 · 400</small></p></div>
          <div class="cr-tarjeta cr-pila"><div class="g-muestras">
            <span class="g-muestra"><i style="background:var(--cr-acento)"></i>Acento</span><span class="g-muestra"><i style="background:var(--cr-acento-suave)"></i>Suave</span>
            <span class="g-muestra"><i style="background:var(--cr-fondo)"></i>Fondo</span><span class="g-muestra"><i style="background:var(--cr-superficie)"></i>Superficie</span>
            <span class="g-muestra"><i style="background:var(--cr-ok)"></i>Correcto</span><span class="g-muestra"><i style="background:var(--cr-aviso)"></i>Aviso</span><span class="g-muestra"><i style="background:var(--cr-error)"></i>Error</span></div>
            <div class="cr-fila-flex"><button class="cr-boton primario">Primario</button><button class="cr-boton secundario">Secundario</button><button class="cr-boton">Normal</button><button class="cr-boton fantasma">Fantasma</button><button class="cr-boton peligro">Eliminar</button><button class="cr-boton primario" aria-busy="true">Guardando</button></div>
            <p class="g-codigo">Movimiento: 160 / 280 / 460 ms · solo transform, opacity y filter · resorte en hojas, interruptores y avisos · respeta “reducir movimiento”.</p>
          </div>
        </div>
      </section>
    </main>
  </div>
</div>

<dialog class="cr-hoja" id="hoja-nuevo" aria-labelledby="hoja-titulo">
  <div class="cr-hoja-cab"><h3 id="hoja-titulo">Nueva clase</h3><button class="cr-cerrar" data-cr-cerrar aria-label="Cerrar">✕</button></div>
  <div class="cr-hoja-cuerpo">
    <div class="cr-campo"><label for="h-aprendiz">Aprendiz</label><input class="cr-input" id="h-aprendiz" placeholder="Busca por nombre o documento"></div>
    <div class="cr-rejilla" style="--min:160px"><div class="cr-campo"><label for="h-fecha">Fecha</label><input class="cr-input" id="h-fecha" type="date"></div><div class="cr-campo"><label for="h-hora">Hora</label><input class="cr-input" id="h-hora" type="time" value="07:30"></div></div>
    <div class="cr-segmentado" role="radiogroup" aria-label="Tipo de clase"><label><input type="radio" name="tipo" checked>Práctica</label><label><input type="radio" name="tipo">Teoría</label><label><input type="radio" name="tipo">Examen</label></div>
  </div>
  <div class="cr-hoja-pie"><button class="cr-boton" data-cr-cerrar>Cancelar</button><button class="cr-boton primario" onclick="cristal.cerrar('hoja-nuevo'); cristal.aviso('Clase agendada', { tipo: 'ok' })">Agendar</button></div>
</dialog>

${js}
<script>
document.getElementById("g-form").addEventListener("submit", function (e) {
  e.preventDefault();
  var campo = document.getElementById("g-nombre").closest(".cr-campo");
  if (!document.getElementById("g-nombre").value.trim()) { campo.classList.remove("invalido"); void campo.offsetWidth; campo.classList.add("invalido"); cristal.aviso("Falta el nombre del aprendiz", { tipo: "error" }); return; }
  campo.classList.remove("invalido");
  var b = e.submitter; b.setAttribute("aria-busy", "true");
  setTimeout(function () { b.removeAttribute("aria-busy"); cristal.aviso("Aprendiz guardado", { tipo: "ok" }); e.target.reset(); }, 900);
});
document.getElementById("g-nombre").addEventListener("input", function () { this.closest(".cr-campo").classList.remove("invalido"); });
</script>
</body>
</html>
`
}
