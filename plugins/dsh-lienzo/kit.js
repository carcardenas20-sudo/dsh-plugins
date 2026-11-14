// Kit de diseño de dsh-lienzo: estilos y comportamiento que van DENTRO de cada HTML
// (sin internet). El agente escribe solo el contenido con estas clases; el kit pone
// tipografía, color, espaciado, modo oscuro, celular y las piezas interactivas.

export const CSS = String.raw`
:root{
  --acento:#2f5bd3;--acento-2:#0e8a7a;
  --bg:#f6f5f2;--panel:#ffffff;--panel-2:#f2f1ed;--hundido:#ebe9e4;
  --tinta:#1b1f24;--suave:#545b66;--tenue:#666c75;
  --borde:#e2dfd8;--borde-2:#d3cfc6;
  --ok:#17693a;--aviso:#8a5a10;--error:#a8322d;--info:#2f5bd3;
  --ok-bg:#e6f4ea;--aviso-bg:#fbf1dc;--error-bg:#fbe7e5;--info-bg:#e8eefc;
  --sombra:0 1px 2px rgba(20,22,26,.05),0 4px 14px rgba(20,22,26,.05);
  --sombra-alta:0 2px 6px rgba(20,22,26,.06),0 14px 34px rgba(20,22,26,.10);
  --radio:14px;--radio-chico:9px;
  --fuente:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Roboto,Arial,sans-serif;
  --fuente-titulo:"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Roboto,Arial,sans-serif;
  --mono:ui-monospace,"Cascadia Mono",Consolas,"SF Mono",monospace;
  color-scheme:light;
}
:root[data-tema="oscuro"]{
  --bg:#121417;--panel:#1a1d22;--panel-2:#20242a;--hundido:#0e1013;
  --tinta:#eceef1;--suave:#a8afb9;--tenue:#7d8590;
  --borde:#2b3037;--borde-2:#39404a;
  --acento:#7ea2ff;--acento-2:#4fd1bd;
  --ok:#5fcf8e;--aviso:#e7b35a;--error:#f0817b;--info:#7ea2ff;
  --ok-bg:#16301f;--aviso-bg:#33280f;--error-bg:#3a1a19;--info-bg:#1a2442;
  --sombra:none;--sombra-alta:0 10px 30px rgba(0,0,0,.45);color-scheme:dark;
}
@media (prefers-color-scheme:dark){:root:not([data-tema="claro"]){
  --bg:#121417;--panel:#1a1d22;--panel-2:#20242a;--hundido:#0e1013;
  --tinta:#eceef1;--suave:#a8afb9;--tenue:#7d8590;
  --borde:#2b3037;--borde-2:#39404a;
  --acento:#7ea2ff;--acento-2:#4fd1bd;
  --ok:#5fcf8e;--aviso:#e7b35a;--error:#f0817b;--info:#7ea2ff;
  --ok-bg:#16301f;--aviso-bg:#33280f;--error-bg:#3a1a19;--info-bg:#1a2442;
  --sombra:none;--sombra-alta:0 10px 30px rgba(0,0,0,.45);color-scheme:dark;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--tinta);font:16px/1.6 var(--fuente);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img,svg{max-width:100%}
a{color:var(--acento);text-underline-offset:2px}
code{font-family:var(--mono);font-size:.88em;background:var(--panel-2);border:1px solid var(--borde);border-radius:6px;padding:1px 6px}
p{margin:0 0 .8em}
h1,h2,h3,h4{font-family:var(--fuente-titulo);line-height:1.2;letter-spacing:-.015em;margin:0;text-wrap:balance}
:focus-visible{outline:2px solid var(--acento);outline-offset:2px}

/* ---------- página ---------- */
.lz-pagina{max-width:1180px;margin:0 auto;padding:40px 28px 80px}
.lz-pagina.angosta{max-width:860px}
.lz-barra-sup{display:flex;justify-content:flex-end;gap:8px;margin:-16px 0 12px}
.lz-encabezado{margin:0 0 36px;max-width:78ch}
.lz-antetitulo{font-size:12.5px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--acento);margin:0 0 10px}
.lz-encabezado h1{font-size:clamp(28px,4.2vw,42px);font-weight:700;margin:0 0 14px}
.lz-entrada{font-size:18px;line-height:1.55;color:var(--suave);margin:0 0 16px;max-width:68ch}
.lz-meta{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13.5px;color:var(--tenue)}
.lz-meta span{display:inline-flex;align-items:center;gap:6px}
.lz-seccion{margin:0 0 48px}
.lz-seccion>h2{font-size:22px;font-weight:680;margin:0 0 6px}
.lz-seccion>.lz-desc{color:var(--suave);margin:0 0 20px;max-width:72ch}
.lz-separador{height:1px;background:var(--borde);border:0;margin:40px 0}
.lz-prosa{max-width:72ch}
.lz-prosa ul,.lz-prosa ol{padding-left:22px;margin:0 0 .8em}
.lz-prosa li{margin:.25em 0}

/* ---------- rejillas y tarjetas ---------- */
.lz-rejilla{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--min,260px)),1fr))}
.lz-rejilla.dos{--min:380px}.lz-rejilla.tres{--min:280px}.lz-rejilla.cuatro{--min:210px}
.lz-tarjeta{background:var(--panel);border:1px solid var(--borde);border-radius:var(--radio);box-shadow:var(--sombra);padding:22px 22px 20px;min-width:0}
.lz-tarjeta>h3{font-size:17px;font-weight:650;margin:0 0 8px}
.lz-tarjeta>p:last-child{margin-bottom:0}
.lz-tarjeta .lz-desc{color:var(--suave);font-size:14.5px}
.lz-tarjeta.destacada{border-color:color-mix(in srgb,var(--acento) 45%,var(--borde));box-shadow:0 0 0 3px color-mix(in srgb,var(--acento) 12%,transparent),var(--sombra)}
.lz-icono{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--acento) 12%,transparent);color:var(--acento);font-size:19px;margin:0 0 14px}

/* ---------- KPIs ---------- */
.lz-kpis{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));margin:0 0 8px}
.lz-kpi{background:var(--panel);border:1px solid var(--borde);border-radius:var(--radio);padding:18px 20px;box-shadow:var(--sombra);min-width:0}
.lz-kpi .valor{font-family:var(--fuente-titulo);font-size:32px;font-weight:700;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}
.lz-kpi .etiqueta{font-size:13.5px;color:var(--suave);margin-top:4px}
.lz-kpi .cambio{font-size:13px;font-weight:600;margin-top:8px}
.lz-kpi .cambio.sube{color:var(--ok)}.lz-kpi .cambio.baja{color:var(--error)}

/* ---------- chips y notas ---------- */
.lz-chip{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;line-height:1;padding:6px 10px;border-radius:999px;background:var(--panel-2);color:var(--suave);border:1px solid var(--borde);white-space:nowrap;vertical-align:middle}
.lz-chip::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.85}
.lz-chip.sin-punto::before{display:none}
.lz-chip.ok{background:var(--ok-bg);color:var(--ok);border-color:transparent}
.lz-chip.aviso{background:var(--aviso-bg);color:var(--aviso);border-color:transparent}
.lz-chip.error{background:var(--error-bg);color:var(--error);border-color:transparent}
.lz-chip.info{background:var(--info-bg);color:var(--info);border-color:transparent}
.lz-nota{border-radius:var(--radio-chico);padding:14px 16px 14px 18px;background:var(--info-bg);border-left:4px solid var(--info);margin:0 0 18px;font-size:15px}
.lz-nota>strong:first-child{display:block;margin-bottom:2px}
.lz-nota.ok{background:var(--ok-bg);border-color:var(--ok)}
.lz-nota.aviso{background:var(--aviso-bg);border-color:var(--aviso)}
.lz-nota.error{background:var(--error-bg);border-color:var(--error)}
.lz-nota p:last-child{margin:0}

/* ---------- storyboard (recorridos de usuario, procesos con pantallas) ---------- */
.lz-storyboard{position:relative}
.lz-storyboard-pista{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(290px,1fr);gap:20px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 4px 18px;scrollbar-width:thin}
.lz-storyboard-pista:has(> :nth-child(5)){grid-auto-columns:300px}
.lz-escena{scroll-snap-align:start;background:var(--panel);border:1px solid var(--borde);border-radius:var(--radio);box-shadow:var(--sombra);display:flex;flex-direction:column;min-width:0;overflow:hidden}
.lz-escena-cab{display:flex;align-items:center;gap:10px;padding:14px 16px 0}
.lz-num{flex:none;width:28px;height:28px;border-radius:50%;background:var(--acento);color:#fff;font-size:13.5px;font-weight:700;display:grid;place-items:center;font-variant-numeric:tabular-nums}
.lz-escena-cab h3{font-size:16px;font-weight:650;flex:1;min-width:0}
.lz-escena-cab .lz-tiempo{font-size:12.5px;color:var(--tenue);font-variant-numeric:tabular-nums;white-space:nowrap}
.lz-escena-vista{padding:16px;display:grid;place-items:center;background:linear-gradient(180deg,var(--panel) 0,var(--panel-2) 100%);border-bottom:1px solid var(--borde)}
.lz-escena-texto{padding:14px 16px 16px;font-size:14px;display:grid;gap:10px}
.lz-escena-texto dl{margin:0;display:grid;gap:9px}
.lz-escena-texto dt{font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--tenue);margin:0 0 1px}
.lz-escena-texto dd{margin:0;color:var(--tinta);line-height:1.45}
.lz-storyboard-nav{display:flex;gap:8px;justify-content:flex-end;margin:0 0 10px}
.lz-boton-nav{font:inherit;font-size:18px;line-height:1;width:38px;height:38px;border-radius:50%;border:1px solid var(--borde-2);background:var(--panel);color:var(--tinta);cursor:pointer;box-shadow:var(--sombra)}
.lz-boton-nav:hover{border-color:var(--acento);color:var(--acento)}

/* ---------- maquetas de pantalla ---------- */
.lz-pantalla{--ancho:220px;width:var(--ancho);max-width:100%;background:var(--panel);border:1px solid var(--borde-2);border-radius:14px;box-shadow:var(--sombra-alta);overflow:hidden;display:flex;flex-direction:column;font-size:12.5px;line-height:1.35;color:var(--tinta)}
.lz-pantalla.celular{--ancho:200px;border-radius:26px;border:7px solid #1f2329;aspect-ratio:9/17.5}
.lz-pantalla.tablet{--ancho:270px;border-radius:18px;border:8px solid #1f2329;aspect-ratio:4/3}
.lz-pantalla.monitor{--ancho:280px;border-radius:10px;border:6px solid #1f2329;aspect-ratio:16/10}
.lz-pantalla.kiosco{--ancho:210px;border-radius:12px;border:9px solid #2b3036;aspect-ratio:3/4}
.lz-pantalla.ancha{--ancho:100%}
:root[data-tema="oscuro"] .lz-pantalla.celular,:root[data-tema="oscuro"] .lz-pantalla.tablet,:root[data-tema="oscuro"] .lz-pantalla.monitor,:root[data-tema="oscuro"] .lz-pantalla.kiosco{border-color:#3a4049}
.lz-ui-barra{display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--acento);color:#fff;font-weight:650;font-size:12px;flex:none}
.lz-ui-barra small{margin-left:auto;font-weight:500;opacity:.85}
.lz-ui-cuerpo{flex:1;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden}
.lz-ui-centro{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center}
.lz-ui-titulo{font-weight:700;font-size:13.5px}
.lz-ui-texto{color:var(--suave);font-size:11.5px}
.lz-ui-campo{border:1px solid var(--borde-2);border-radius:7px;padding:6px 8px;color:var(--tenue);background:var(--panel);font-size:11.5px}
.lz-ui-boton{display:block;text-align:center;border-radius:8px;padding:7px 10px;background:var(--acento);color:#fff;font-weight:650;font-size:12px}
.lz-ui-boton.secundario{background:transparent;color:var(--acento);border:1px solid var(--acento)}
.lz-ui-lista{display:grid;gap:5px;margin:0;padding:0;list-style:none}
.lz-ui-lista li{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;background:var(--panel-2);font-size:11.5px}
.lz-ui-lista li.activo{background:color-mix(in srgb,var(--acento) 14%,var(--panel));font-weight:650}
.lz-ui-lista li .lz-chip{margin-left:auto;padding:3px 7px;font-size:10.5px}
.lz-ui-camara{width:74px;height:74px;border-radius:50%;border:3px dashed var(--acento);display:grid;place-items:center;font-size:30px;background:color-mix(in srgb,var(--acento) 8%,transparent)}
.lz-ui-camara.ok{border-style:solid;border-color:var(--ok);background:var(--ok-bg)}
.lz-ui-camara.error{border-style:solid;border-color:var(--error);background:var(--error-bg)}
.lz-ui-temporizador{font-family:var(--fuente-titulo);font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.lz-ui-progreso{height:6px;border-radius:99px;background:var(--hundido);overflow:hidden}
.lz-ui-progreso>i{display:block;height:100%;width:var(--valor,50%);background:var(--acento);border-radius:inherit}
.lz-ui-alerta{border-radius:7px;padding:6px 8px;font-size:11.5px;background:var(--aviso-bg);color:var(--aviso);font-weight:600}
.lz-ui-alerta.ok{background:var(--ok-bg);color:var(--ok)}.lz-ui-alerta.error{background:var(--error-bg);color:var(--error)}
.lz-ui-fila{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px}

/* ---------- pasos numerados (vertical) ---------- */
.lz-pasos{list-style:none;margin:0;padding:0;counter-reset:paso;display:grid;gap:0}
.lz-pasos>li{counter-increment:paso;position:relative;padding:0 0 26px 54px;min-height:40px}
.lz-pasos>li::before{content:counter(paso);position:absolute;left:0;top:-2px;width:34px;height:34px;border-radius:50%;background:var(--panel);border:2px solid var(--acento);color:var(--acento);font-weight:700;font-size:14.5px;display:grid;place-items:center}
.lz-pasos>li::after{content:"";position:absolute;left:16px;top:36px;bottom:4px;width:2px;background:var(--borde-2)}
.lz-pasos>li:last-child{padding-bottom:0}.lz-pasos>li:last-child::after{display:none}
.lz-pasos>li>h3,.lz-pasos>li>strong:first-child{display:block;font-size:16.5px;font-weight:650;margin:3px 0 4px}
.lz-pasos>li>p{color:var(--suave);margin:0 0 6px}

/* ---------- línea de tiempo ---------- */
.lz-linea-tiempo{position:relative;display:grid;gap:22px;padding-left:28px}
.lz-linea-tiempo::before{content:"";position:absolute;left:8px;top:6px;bottom:6px;width:2px;background:linear-gradient(var(--acento),var(--acento-2))}
.lz-hito{position:relative}
.lz-hito::before{content:"";position:absolute;left:-26px;top:5px;width:14px;height:14px;border-radius:50%;background:var(--panel);border:3px solid var(--acento)}
.lz-hito.hecho::before{background:var(--acento)}
.lz-hito .cuando{font-size:12.5px;font-weight:650;color:var(--acento);letter-spacing:.03em;text-transform:uppercase}
.lz-hito h3{font-size:16.5px;font-weight:650;margin:2px 0 4px}
.lz-hito p{color:var(--suave);margin:0}

/* ---------- flujo horizontal corto (para diagramas grandes usa dsh-planos) ---------- */
.lz-flujo{display:flex;flex-wrap:wrap;align-items:stretch;gap:8px;row-gap:14px}
.lz-flujo>.lz-nodo{flex:1 1 150px;min-width:0;background:var(--panel);border:1px solid var(--borde);border-radius:var(--radio-chico);padding:12px 14px;box-shadow:var(--sombra);position:relative}
.lz-flujo>.lz-nodo:not(:last-child)::after{content:"→";position:absolute;right:-9px;top:50%;transform:translate(50%,-50%);color:var(--tenue);font-size:18px;z-index:1}
.lz-nodo .tipo{font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--tenue)}
.lz-nodo strong{display:block;font-size:15px;margin:2px 0}
.lz-nodo p{font-size:13.5px;color:var(--suave);margin:0}
.lz-nodo.decision{border-style:dashed;border-color:var(--aviso)}
.lz-nodo.inicio,.lz-nodo.fin{background:var(--panel-2);border-radius:999px;text-align:center}

/* ---------- carriles (quién hace qué en cada etapa) ---------- */
.lz-carriles{display:grid;grid-template-columns:150px repeat(var(--etapas,4),minmax(170px,1fr));border:1px solid var(--borde);border-radius:var(--radio);overflow:auto;background:var(--panel);box-shadow:var(--sombra)}
.lz-carriles>*{padding:12px 14px;border-bottom:1px solid var(--borde);border-right:1px solid var(--borde);font-size:14px;min-width:0}
.lz-carriles>.cab{background:var(--panel-2);font-weight:650;font-size:13px;color:var(--suave)}
.lz-carriles>.actor{background:var(--panel-2);font-weight:650;position:sticky;left:0;z-index:1}
.lz-carriles>.vacio{background:repeating-linear-gradient(135deg,transparent 0 8px,color-mix(in srgb,var(--borde) 45%,transparent) 8px 9px)}

/* ---------- tablas ---------- */
.lz-tabla-caja{overflow-x:auto;border:1px solid var(--borde);border-radius:var(--radio);background:var(--panel);box-shadow:var(--sombra)}
.lz-tabla{width:100%;border-collapse:collapse;font-size:14.5px}
.lz-tabla th{text-align:left;font-size:12.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--suave);background:var(--panel-2);padding:11px 14px;border-bottom:1px solid var(--borde);white-space:nowrap}
.lz-tabla td{padding:11px 14px;border-bottom:1px solid var(--borde);vertical-align:top}
.lz-tabla tr:last-child td{border-bottom:0}
.lz-tabla tbody tr:hover td{background:color-mix(in srgb,var(--acento) 4%,transparent)}
.lz-tabla .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}

/* ---------- comparar ---------- */
.lz-comparar{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr))}
.lz-comparar .lz-tarjeta ul{margin:8px 0 0;padding-left:20px}
.lz-comparar .lz-tarjeta li{margin:4px 0}
.lz-pro::marker{content:"✓  ";color:var(--ok);font-weight:700}
.lz-contra::marker{content:"✕  ";color:var(--error);font-weight:700}

/* ---------- pestañas ---------- */
.lz-pestanas>.lz-pestanas-lista{display:flex;gap:4px;border-bottom:1px solid var(--borde);margin:0 0 18px;overflow-x:auto}
.lz-pestanas-lista button{font:inherit;font-size:14.5px;font-weight:600;color:var(--suave);background:none;border:0;border-bottom:2px solid transparent;padding:10px 14px;cursor:pointer;white-space:nowrap;margin-bottom:-1px}
.lz-pestanas-lista button[aria-selected="true"]{color:var(--acento);border-bottom-color:var(--acento)}
.lz-pestanas>[data-panel][hidden]{display:none}

/* ---------- detalles plegables ---------- */
.lz-plegable{background:var(--panel);border:1px solid var(--borde);border-radius:var(--radio-chico);margin:0 0 10px}
.lz-plegable>summary{cursor:pointer;padding:12px 16px;font-weight:650;list-style:none;display:flex;align-items:center;gap:10px}
.lz-plegable>summary::before{content:"›";font-size:20px;line-height:1;color:var(--tenue);transition:transform .15s}
.lz-plegable[open]>summary::before{transform:rotate(90deg)}
.lz-plegable>summary::-webkit-details-marker{display:none}
.lz-plegable>div{padding:0 16px 14px 34px;color:var(--suave)}

/* ---------- utilidades ---------- */
.lz-boton{font:inherit;font-size:13.5px;font-weight:600;border:1px solid var(--borde-2);background:var(--panel);color:var(--tinta);border-radius:999px;padding:7px 14px;cursor:pointer}
.lz-boton:hover{border-color:var(--acento);color:var(--acento)}
.lz-suave{color:var(--suave)}.lz-tenue{color:var(--tenue)}.lz-centro{text-align:center}
.lz-pie{margin-top:56px;padding-top:18px;border-top:1px solid var(--borde);font-size:13px;color:var(--tenue)}

/* ---------- celular ---------- */
@media (max-width:720px){
  .lz-pagina{padding:62px 16px 56px}
  .lz-entrada{font-size:16.5px}
  .lz-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .lz-kpi{padding:14px 14px}
  .lz-kpi .valor{font-size:25px}
  .lz-seccion{margin-bottom:36px}
  .lz-storyboard-pista{grid-auto-flow:row;grid-auto-columns:auto;overflow:visible;scroll-snap-type:none;padding:0}
  .lz-storyboard-pista:has(> :nth-child(5)){grid-auto-columns:auto}
  .lz-storyboard-nav{display:none}
  .lz-flujo{flex-direction:column}
  .lz-flujo>.lz-nodo:not(:last-child)::after{content:"↓";right:50%;top:auto;bottom:-9px;transform:translate(50%,50%)}
  .lz-carriles{grid-template-columns:110px repeat(var(--etapas,4),minmax(150px,1fr))}
}
@media print{.lz-barra-sup,.lz-storyboard-nav{display:none}.lz-storyboard-pista{grid-auto-flow:row;overflow:visible}body{background:#fff}}
`

export const JS = String.raw`
(function(){
  var raiz=document.documentElement;
  try{var t=localStorage.getItem('lz-tema');if(t)raiz.setAttribute('data-tema',t)}catch(e){}
  document.addEventListener('click',function(ev){
    var b=ev.target.closest('[data-lz-tema]');
    if(b){var oscuro=raiz.getAttribute('data-tema')==='oscuro'||(!raiz.getAttribute('data-tema')&&matchMedia('(prefers-color-scheme: dark)').matches);
      var nuevo=oscuro?'claro':'oscuro';raiz.setAttribute('data-tema',nuevo);try{localStorage.setItem('lz-tema',nuevo)}catch(e){}return}
    var n=ev.target.closest('[data-lz-mover]');
    if(n){var sb=n.closest('.lz-storyboard');var p=sb&&sb.querySelector('.lz-storyboard-pista');if(p){var e=p.firstElementChild;var paso=e?e.getBoundingClientRect().width+20:300;p.scrollBy({left:paso*Number(n.getAttribute('data-lz-mover')),behavior:'smooth'})}return}
    var tab=ev.target.closest('.lz-pestanas-lista button');
    if(tab){var cont=tab.closest('.lz-pestanas');var id=tab.getAttribute('data-pestana');
      cont.querySelectorAll('.lz-pestanas-lista button').forEach(function(x){x.setAttribute('aria-selected',String(x===tab))});
      cont.querySelectorAll(':scope > [data-panel]').forEach(function(pn){pn.hidden=pn.getAttribute('data-panel')!==id})}
  });
  function preparar(){
    document.querySelectorAll('.lz-pestanas').forEach(function(c){
      var bs=c.querySelectorAll('.lz-pestanas-lista button');if(!bs.length)return;
      var activo=Array.prototype.find.call(bs,function(b){return b.getAttribute('aria-selected')==='true'})||bs[0];
      bs.forEach(function(b){b.setAttribute('role','tab');b.setAttribute('aria-selected',String(b===activo))});
      c.querySelectorAll(':scope > [data-panel]').forEach(function(pn){pn.hidden=pn.getAttribute('data-panel')!==activo.getAttribute('data-pestana')});
    });
    document.querySelectorAll('.lz-storyboard').forEach(function(sb){
      if(sb.querySelector('.lz-storyboard-nav'))return;var p=sb.querySelector('.lz-storyboard-pista');if(!p||p.children.length<4)return;
      var nav=document.createElement('div');nav.className='lz-storyboard-nav';
      nav.innerHTML='<button class="lz-boton-nav" data-lz-mover="-1" aria-label="Anterior">‹</button><button class="lz-boton-nav" data-lz-mover="1" aria-label="Siguiente">›</button>';
      sb.insertBefore(nav,p);
    });
    document.querySelectorAll('.lz-carriles').forEach(function(c){
      if(c.style.getPropertyValue('--etapas'))return;var cabs=c.querySelectorAll(':scope > .cab').length;if(cabs>1)c.style.setProperty('--etapas',cabs-1);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',preparar);else preparar();
})();
`

// Catálogo que lee el agente (lienzo_guia). Cada pieza con su HTML de ejemplo.
export const GUIA = {
  reglas: `REGLAS DE DISEÑO (síguelas; la revisión automática y el usuario lo notan)
1. Elige el formato por el contenido, no al revés:
   - Recorrido de usuario / proceso con pantallas → STORYBOARD (una escena por paso con la maqueta de lo que se ve, qué hace la persona y qué hace el sistema).
   - Proceso sin pantallas, 3 a 7 pasos → PASOS numerados, o FLUJO horizontal si cabe en una línea.
   - Quién hace qué en cada etapa → CARRILES.
   - Cronología, fases, hoja de ruta → LÍNEA DE TIEMPO.
   - Cifras clave → KPIS arriba, detalle abajo en TABLA.
   - Opciones a decidir → COMPARAR con pros y contras y una nota con la recomendación.
   - Mucho contenido paralelo → PESTAÑAS. Detalles secundarios → PLEGABLES.
   - Diagramas con muchas conexiones (arquitectura, base de datos, redes) → usa la herramienta visualizar de dsh-planos, no esto.
2. Estructura: .lz-pagina > .lz-encabezado (antetítulo, h1, entrada de 1-2 frases, meta) > secciones .lz-seccion con h2 y .lz-desc. Lo más importante primero.
3. Texto: frases cortas y concretas, con los datos reales del proyecto (nombres de pantallas, tiempos, reglas). Nada de relleno ni "Lorem". Máximo ~25 palabras por párrafo en tarjetas y escenas.
4. Usa SOLO las clases del kit y su paleta (variables CSS). Si necesitas un estilo propio, ponlo en "estilos" usando var(--acento), var(--suave), etc.; nunca colores fijos que rompan el modo oscuro.
5. Emojis solo como iconos sobrios dentro de .lz-icono o maquetas (uno por elemento), no en títulos.
6. No uses recursos de internet (fuentes, scripts, imágenes): la página debe abrir sin conexión.
7. Después de crear, lee el resultado de la revisión y corrige TODO lo que reporte antes de entregar.`,
  piezas: {
    encabezado: `<div class="lz-pagina">
  <header class="lz-encabezado">
    <p class="lz-antetitulo">Recorrido del usuario</p>
    <h1>Pantalla de cola del biometrador</h1>
    <p class="lz-entrada">Qué ve y qué hace cada persona en los 5 pasos de una sesión, y qué registra AULAPP.</p>
    <div class="lz-meta"><span>⏱ 90 s por sesión</span><span>📄 Basado en: especificación del modo manual</span></div>
  </header>
  <section class="lz-seccion"><h2>Título de sección</h2><p class="lz-desc">Para qué sirve esta sección.</p> ... </section>
</div>`,
    storyboard: `<div class="lz-storyboard"><div class="lz-storyboard-pista">
  <article class="lz-escena">
    <div class="lz-escena-cab"><span class="lz-num">1</span><h3>Login del instructor</h3><span class="lz-tiempo">0–15 s</span></div>
    <div class="lz-escena-vista">
      <div class="lz-pantalla kiosco"><div class="lz-ui-barra">AULAPP <small>Puesto 2</small></div>
        <div class="lz-ui-cuerpo"><div class="lz-ui-centro"><div class="lz-ui-titulo">Ingresa tu documento</div>
          <div class="lz-ui-campo">C.C. ••••••</div><span class="lz-ui-boton">Continuar</span></div></div></div>
    </div>
    <div class="lz-escena-texto"><dl>
      <div><dt>Persona</dt><dd>El instructor digita su documento.</dd></div>
      <div><dt>Sistema</dt><dd>Valida que tenga la sesión asignada y abre la cámara.</dd></div>
    </dl></div>
  </article>
  <!-- una .lz-escena por paso -->
</div></div>
Pantallas: .lz-pantalla + celular | tablet | monitor | kiosco | ancha. Dentro: .lz-ui-barra, .lz-ui-cuerpo, .lz-ui-centro, .lz-ui-titulo, .lz-ui-texto, .lz-ui-campo, .lz-ui-boton(.secundario), .lz-ui-lista>li(.activo), .lz-ui-camara(.ok|.error), .lz-ui-temporizador, .lz-ui-progreso>i style="--valor:60%", .lz-ui-alerta(.ok|.error), .lz-ui-fila.`,
    pasos: `<ol class="lz-pasos">
  <li><h3>Recibir el pedido</h3><p>Ventas lo registra con cliente, prendas y fecha de entrega.</p><span class="lz-chip info">Ventas</span></li>
  <li><h3>Cortar</h3><p>...</p></li>
</ol>`,
    flujo: `<div class="lz-flujo">
  <div class="lz-nodo inicio"><strong>Llega el aprendiz</strong></div>
  <div class="lz-nodo"><span class="tipo">Paso</span><strong>Biometría</strong><p>Rostro en 10 s.</p></div>
  <div class="lz-nodo decision"><span class="tipo">Decisión</span><strong>¿Coincide?</strong></div>
  <div class="lz-nodo fin"><strong>Práctica iniciada</strong></div>
</div>`,
    carriles: `<div class="lz-carriles">
  <div class="cab"></div><div class="cab">Antes</div><div class="cab">Durante</div><div class="cab">Después</div>
  <div class="actor">Instructor</div><div>Abre la sesión</div><div>Supervisa</div><div class="vacio"></div>
  <div class="actor">AULAPP</div><div>Asigna kit</div><div>Cuenta 90 s</div><div>Guarda asistencia</div>
</div>
(Pon tantas celdas .cab como etapas + 1 vacía; cada fila: .actor + una celda por etapa; .vacio si no aplica.)`,
    linea_tiempo: `<div class="lz-linea-tiempo">
  <div class="lz-hito hecho"><div class="cuando">Semana 1</div><h3>Prototipo</h3><p>Pantalla de cola funcionando.</p></div>
  <div class="lz-hito"><div class="cuando">Semana 3</div><h3>Piloto en Girardot</h3><p>...</p></div>
</div>`,
    kpis: `<div class="lz-kpis">
  <div class="lz-kpi"><div class="valor">90 s</div><div class="etiqueta">Duración de la secuencia</div><div class="cambio sube">▲ 12% vs. mes pasado</div></div>
</div>`,
    tarjetas: `<div class="lz-rejilla tres">
  <div class="lz-tarjeta"><div class="lz-icono">🔐</div><h3>Título</h3><p class="lz-desc">Texto corto.</p></div>
  <div class="lz-tarjeta destacada">...</div>
</div>  (.lz-rejilla .dos | .tres | .cuatro)`,
    tabla: `<div class="lz-tabla-caja"><table class="lz-tabla">
  <thead><tr><th>Sesión</th><th>Kit</th><th class="num">Duración</th><th>Estado</th></tr></thead>
  <tbody><tr><td>Par</td><td>A</td><td class="num">90 s</td><td><span class="lz-chip ok">Lista</span></td></tr></tbody>
</table></div>`,
    comparar: `<div class="lz-comparar">
  <div class="lz-tarjeta"><h3>Opción A</h3><p class="lz-desc">Resumen.</p><ul><li class="lz-pro">Ventaja</li><li class="lz-contra">Desventaja</li></ul></div>
  <div class="lz-tarjeta destacada"><h3>Opción B <span class="lz-chip ok">Recomendada</span></h3>...</div>
</div>`,
    pestanas: `<div class="lz-pestanas">
  <div class="lz-pestanas-lista"><button data-pestana="par">Sesión par</button><button data-pestana="impar">Sesión impar</button></div>
  <div data-panel="par">...</div>
  <div data-panel="impar">...</div>
</div>`,
    notas_y_chips: `<div class="lz-nota aviso"><strong>Ojo</strong><p>Si la cámara falla 2 veces, pasa a registro manual.</p></div>
(.lz-nota sola = info; .ok .aviso .error)
<span class="lz-chip ok">Aprobado</span> <span class="lz-chip aviso">Pendiente</span> <span class="lz-chip error">Bloqueado</span> <span class="lz-chip info">Nuevo</span>`,
    plegable: `<details class="lz-plegable"><summary>¿Qué pasa si el aprendiz no llega?</summary><div><p>Respuesta.</p></div></details>`,
  },
}
