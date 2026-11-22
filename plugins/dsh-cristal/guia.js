// Reglas de diseño y catálogo de piezas de dsh-cristal (lo que lee el agente con cristal_guia).

export const PRINCIPIOS = `PRINCIPIOS CRISTAL — síguelos en cada pantalla (el revisor y el usuario lo notan)

1. El contenido manda. Fondo neutro (var(--cr-fondo)), superficies blancas o grafito, UN color de acento solo para lo que se puede tocar o lo que está activo. Verde/ámbar/rojo solo para estados.
2. Jerarquía por tamaño y peso, no por colores. Un h1 por pantalla, h2 por sección, texto de 17 px. Secundario en var(--cr-texto-2), terciario en var(--cr-texto-3). Máximo tres niveles de texto dentro de una tarjeta.
3. Aire. Todo espacio sale de la rejilla de 4 px (var(--cr-e2)…var(--cr-e24)) y se pone con gap, no con márgenes sueltos. Entre secciones var(--cr-e8); dentro de tarjetas var(--cr-e6).
4. Profundidad con intención. Sombra solo en lo que flota o se toca (tarjetas interactivas, hojas, avisos). Vidrio (.cr-barra, .cr-vidrio) solo en capas que flotan sobre contenido: barra superior, menús, hojas. Nunca vidrio en tarjetas de contenido ni texto sobre fondos con mucho detalle.
5. Movimiento con propósito. Cada animación responde a algo: entrar, salir, cambiar de estado o responder al toque.
   - Solo transform, opacity y filter (nunca width, height, top, left o margin: se traban).
   - 160 ms para responder a un toque o al cursor, 280 ms para cambios de estado, 460 ms para entradas y hojas.
   - var(--cr-suave) para casi todo; var(--cr-resorte) para lo que "aterriza" (hojas, interruptores, avisos).
   - Entradas escalonadas con .cr-escalonado (hasta 8 elementos); contenido largo con .cr-revela al hacer scroll.
   - Nada infinito salvo indicadores de carga. El kit ya respeta "reducir movimiento": usa sus clases y variables.
6. Respuesta inmediata. Todo lo tocable reacciona (hover y presión: el kit lo trae en .cr-boton, .cr-tarjeta.interactiva, .cr-fila). Mientras guarda: aria-busy="true" en el botón. Al terminar: cristal.aviso("…", { tipo: "ok" }), con "Deshacer" si se puede. Errores junto al campo (.cr-campo.invalido + .error), no solo en un aviso.
7. Nunca una pantalla vacía o congelada. Mientras carga: .cr-esqueleto con el tamaño del contenido final (así no salta). Sin datos: .cr-vacio con explicación y una acción. Error: qué pasó y cómo arreglarlo (.cr-alerta.error).
8. Celular de verdad. Áreas de toque de 44 px, campos con letra de 16 px o más, la barra lateral se desliza (botón con data-cr-menu), las hojas suben desde abajo, las tablas van dentro de .cr-tabla-caja (scroll propio).
9. Claro y oscuro. Solo variables --cr-*; nunca colores fijos (#fff, #000, rgb) en componentes. Íconos con stroke="currentColor".
10. Íconos de un solo estilo: línea de 1,8 px, 18–22 px. En React usa lucide-react; en HTML, SVG en línea. Nunca emojis como íconos.
11. Palabras claras. Botones con verbo y objeto ("Guardar aprendiz", no "Aceptar"); títulos que dicen dónde estás; mensajes sin jerga técnica.
12. Accesible. Cada campo con <label for>, botones de solo ícono con aria-label, foco visible (lo trae el kit), contraste suficiente (lo mide el revisor).

FLUJO
1. Si el proyecto no tiene .dsh-cristal.json, llama cristal_instalar (con el color de marca si el usuario lo dio) y conecta los archivos como te indique.
2. Construye con las piezas de abajo. Puedes combinarlas con utilidades de Tailwind (bg-superficie, text-texto-2, rounded-cr-grande, ease-suave…).
3. Revisa cada pantalla que crees o cambies con cristal_revisar (archivo .html, o la URL del servidor de desarrollo, por ejemplo http://localhost:5173/aprendices). Mira las capturas y corrige todo lo de gravedad alta y media antes de entregar.`

export const PIEZAS = {
  estructura: `<!-- App con barra lateral, barra superior de vidrio y página -->
<div class="cr-app">
  <aside class="cr-lateral" aria-label="Menú">
    <div class="cr-marca"><i></i>Nombre</div>
    <a class="cr-menu-item" href="/" aria-current="page"><svg …/>Resumen</a>
    <a class="cr-menu-item" href="/aprendices"><svg …/>Aprendices</a>
    <div class="cr-menu-titulo">Sistema</div>
    <a class="cr-menu-item" href="/ajustes"><svg …/>Ajustes</a>
  </aside>
  <div class="cr-principal">
    <header class="cr-barra">
      <button class="cr-boton icono fantasma cr-solo-celular" data-cr-menu aria-label="Abrir menú"><svg …/></button>
      <span class="cr-barra-titulo">Aprendices</span><span class="cr-espacio"></span>
      <button class="cr-boton icono" data-cr-tema aria-label="Claro u oscuro"><svg …/></button>
      <button class="cr-boton primario chico" data-cr-abrir="hoja-nuevo">Nuevo</button>
    </header>
    <main class="cr-pagina"> …secciones… </main>
  </div>
</div>`,
  encabezado: `<div class="cr-encabezado">
  <div><p class="cr-antetitulo">Académico</p><h1>Aprendices</h1><p>128 activos en la sede Norte.</p></div>
  <button class="cr-boton primario">Nuevo aprendiz</button>
</div>
<section class="cr-seccion"><div class="cr-seccion-cab"><h2>Próximas clases</h2><a class="cr-boton fantasma chico" href="…">Ver todo</a></div> … </section>`,
  heroe: `<!-- Portada de una página pública (landing) -->
<section class="cr-heroe cr-entra">
  <span class="cr-chip info sin-punto">Nuevo</span>
  <h1>Aprende a conducir <span class="cr-degradado">sin estrés.</span></h1>
  <p>Agenda tus clases, mira tu avance y paga desde el celular.</p>
  <div class="cr-fila-flex"><a class="cr-boton primario grande" href="…">Empezar</a><a class="cr-boton fantasma grande" href="…">Ver cursos</a></div>
</section>`,
  kpis: `<div class="cr-rejilla cr-escalonado" style="--min:150px">
  <div class="cr-kpi"><span class="etiqueta">Aprendices activos</span><span class="valor">1.284</span><span class="cambio sube">▲ 6,2 % vs. mes pasado</span></div>
  <div class="cr-kpi"><span class="etiqueta">Asistencia</span><span class="valor">94 %</span><div class="cr-progreso" style="--valor:94%"><i></i></div></div>
</div>`,
  tarjetas: `<div class="cr-rejilla" style="--min:240px">
  <a class="cr-tarjeta interactiva" href="…"><div class="cr-icono"><svg …/></div><h3>Agendar clase</h3><p class="desc">En tres pasos.</p></a>
</div>
<!-- .cr-tarjeta normal para contenido; .interactiva si toda la tarjeta es un enlace; .plana para fondos secundarios -->`,
  lista: `<p class="cr-lista-titulo">Próximas clases</p>
<div class="cr-lista">
  <a class="cr-fila" href="…"><span class="cr-avatar">LM</span><span class="texto"><strong>Laura Martínez</strong><small>Práctica · Vehículo 12</small></span><span class="detalle">7:30</span></a>
  <label class="cr-fila cr-interruptor"><span class="cr-icono-fila"><svg …/></span><span class="texto"><strong>Recordatorios</strong></span><input type="checkbox" checked></label>
  <button class="cr-fila navega" type="button"><span class="texto"><strong>Sedes</strong></span><span class="detalle">3</span></button>
</div>`,
  tabla: `<div class="cr-tabla-caja"><table class="cr-tabla">
  <thead><tr><th>Aprendiz</th><th>Estado</th><th class="num">Saldo</th></tr></thead>
  <tbody><tr><td class="principal">Laura Martínez</td><td><span class="cr-chip ok">Al día</span></td><td class="num">$ 980.000</td></tr></tbody>
</table></div>
<!-- chips: .ok .aviso .error .info; .sin-punto para quitar el punto -->`,
  formulario: `<form class="cr-formulario" novalidate>
  <div class="cr-rejilla">
    <div class="cr-campo"><label for="nombre">Nombre completo</label><input class="cr-input" id="nombre" required><span class="error">Escribe el nombre.</span></div>
    <div class="cr-campo"><label for="doc">Documento</label><input class="cr-input" id="doc" inputmode="numeric"><span class="ayuda">Sin puntos.</span></div>
    <div class="cr-campo"><label for="sede">Sede</label><select class="cr-select" id="sede"><option>Norte</option></select></div>
  </div>
  <div class="cr-campo"><label for="obs">Observaciones</label><textarea class="cr-area" id="obs"></textarea></div>
  <label class="cr-interruptor"><input type="checkbox"> Enviar bienvenida</label>
  <div class="cr-acciones"><button class="cr-boton" type="button">Cancelar</button><button class="cr-boton primario" type="submit">Guardar aprendiz</button></div>
</form>
<!-- Error: agrega la clase "invalido" al .cr-campo (muestra .error y sacude el campo). Guardando: aria-busy="true" en el botón. -->`,
  controles: `<div class="cr-segmentado" role="radiogroup" aria-label="Periodo">
  <label><input type="radio" name="p" checked>Hoy</label><label><input type="radio" name="p">Semana</label><label><input type="radio" name="p">Mes</label>
</div>
<div class="cr-buscador"><input class="cr-input" type="search" placeholder="Buscar" aria-label="Buscar"></div>
<!-- botones: .primario .secundario .fantasma .peligro · tamaños .chico .grande · .icono (cuadrado, con aria-label) -->`,
  pestanas: `<div class="cr-pestanas">
  <div class="cr-pestanas-lista"><button aria-controls="p-datos" aria-selected="true">Datos</button><button aria-controls="p-pagos">Pagos</button></div>
  <div role="tabpanel" id="p-datos">…</div>
  <div role="tabpanel" id="p-pagos" hidden>…</div>
</div>`,
  hoja: `<!-- Ventana (diálogo). En celular sube desde abajo. Esc o clic afuera la cierran. -->
<button class="cr-boton primario" data-cr-abrir="hoja-nuevo">Nueva clase</button>
<dialog class="cr-hoja" id="hoja-nuevo" aria-labelledby="hoja-titulo">
  <div class="cr-hoja-cab"><h3 id="hoja-titulo">Nueva clase</h3><button class="cr-cerrar" data-cr-cerrar aria-label="Cerrar">✕</button></div>
  <div class="cr-hoja-cuerpo">…campos…</div>
  <div class="cr-hoja-pie"><button class="cr-boton" data-cr-cerrar>Cancelar</button><button class="cr-boton primario">Agendar</button></div>
</dialog>
<!-- Desde código: cristal.abrir("hoja-nuevo") / cristal.cerrar("hoja-nuevo") -->`,
  avisos: `cristal.aviso("Pago registrado", { tipo: "ok" })
cristal.aviso("No se pudo guardar", { tipo: "error" })
cristal.aviso("Aprendiz eliminado", { accion: "Deshacer", alAccion: () => restaurar() })`,
  estados: `<!-- Vacío -->
<div class="cr-tarjeta plana cr-vacio"><div class="cr-icono"><svg …/></div><h3>Aún no hay pagos</h3><p>Cuando registres el primero aparecerá aquí.</p><button class="cr-boton primario">Registrar pago</button></div>
<!-- Cargando: esqueletos del tamaño del contenido final -->
<div class="cr-tarjeta cr-pila"><div class="cr-esqueleto" style="width:40%;height:22px"></div><div class="cr-esqueleto" style="width:90%"></div></div>
<!-- Mensajes -->
<div class="cr-alerta error"><div><strong>No se pudo conectar</strong>Revisa la red y vuelve a intentar.</div></div>`,
  movimiento: `.cr-entra                  entra al cargar (usa style="--i:2" para retrasarlo 2 pasos)
.cr-escalonado             los hijos entran uno tras otro
.cr-revela                 aparece al llegar con el scroll (secciones largas)
.cr-eleva / .cr-presiona   se eleva al pasar el cursor / se encoge al presionar
cristal.transicion(() => cambiarVista())   transición suave entre vistas (View Transitions)
Variables: --cr-rapido 160ms · --cr-medio 280ms · --cr-lento 460ms · --cr-suave · --cr-resorte
Animación propia:  transition: transform var(--cr-medio) var(--cr-suave), opacity var(--cr-medio) var(--cr-suave);`,
  react: `// main.jsx — una sola vez
import "./cristal/cristal.css"
import "./cristal/marca.css"
import "./cristal/cristal.js"

// En JSX: className en vez de class, htmlFor en vez de for, style={{ "--min": "240px" }}
<div className={"cr-campo" + (error ? " invalido" : "")}>…</div>
<button className="cr-boton primario" aria-busy={guardando}>Guardar</button>
<button className="cr-boton primario" data-cr-abrir="hoja-nuevo">Nuevo</button>   // abre <dialog className="cr-hoja" id="hoja-nuevo">
window.cristal.aviso("Guardado", { tipo: "ok" })
// Cambiar de vista con transición: window.cristal.transicion(() => flushSync(() => setVista("detalle")))
// Íconos: import { Users } from "lucide-react";  <Users size={18} strokeWidth={1.8} />`,
}

export function textoGuia(pieza) {
  if (pieza && PIEZAS[pieza]) return `PIEZA: ${pieza}\n\n${PIEZAS[pieza]}`
  return `${PRINCIPIOS}\n\nPIEZAS (copia la estructura, cambia el contenido; la galería del proyecto las muestra todas funcionando):\n${Object.entries(PIEZAS).map(([k, v]) => `\n### ${k}\n${v}`).join('\n')}`
}
