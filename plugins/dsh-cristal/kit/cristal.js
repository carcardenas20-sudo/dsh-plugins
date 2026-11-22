/* Cristal — comportamiento del sistema de diseño (sin dependencias, ~4 KB).
   Funciona con HTML plano y con React/Vue: todo se activa con atributos data-* y
   delegación de eventos, así que no importa si los elementos aparecen después.

   Uso: <script src="cristal/cristal.js" defer></script>   o   import "./cristal/cristal.js"
   API en window.cristal:
     cristal.aviso("Guardado", { tipo: "ok" | "error" | "aviso", accion: "Deshacer", alAccion: fn, ms: 4000 })
     cristal.abrir("id-del-dialog")   cristal.cerrar("id-del-dialog")
     cristal.tema("claro" | "oscuro" | "sistema")
     cristal.transicion(() => { ...cambiar el DOM... })   // transición suave entre vistas
   Atributos:
     data-cr-abrir="id"   data-cr-cerrar   data-cr-tema   data-cr-menu (abre/cierra la barra lateral en celular) */
(function () {
  "use strict";
  if (typeof window === "undefined" || window.cristal) return;
  var doc = document, raiz = doc.documentElement;
  var menosMovimiento = function () { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; };

  // ---------- tema ----------
  function tema(valor) {
    if (valor === "claro" || valor === "oscuro") raiz.setAttribute("data-tema", valor); else raiz.removeAttribute("data-tema");
    try { valor && valor !== "sistema" ? localStorage.setItem("cr-tema", valor) : localStorage.removeItem("cr-tema"); } catch (e) {}
  }
  try { var guardado = localStorage.getItem("cr-tema"); if (guardado) raiz.setAttribute("data-tema", guardado); } catch (e) {}
  function esOscuro() { var t = raiz.getAttribute("data-tema"); return t ? t === "oscuro" : !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches); }

  // ---------- hojas (dialog) ----------
  function abrir(id) {
    var d = typeof id === "string" ? doc.getElementById(id) : id;
    if (!d || d.open) return;
    d.classList.remove("cr-cerrando");
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    var f = d.querySelector("[autofocus], input, select, textarea, button:not(.cr-cerrar)");
    if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function cerrar(id, valor) {
    var d = typeof id === "string" ? doc.getElementById(id) : id;
    if (!d || !d.open || d.classList.contains("cr-cerrando")) return;
    var fin = function () { d.classList.remove("cr-cerrando"); if (d.close) d.close(valor); else d.removeAttribute("open"); };
    if (menosMovimiento()) return fin();
    d.classList.add("cr-cerrando");
    var listo = false, una = function () { if (!listo) { listo = true; fin(); } };
    d.addEventListener("animationend", una, { once: true });
    setTimeout(una, 400);
  }
  doc.addEventListener("cancel", function (e) { if (e.target.matches && e.target.matches("dialog.cr-hoja")) { e.preventDefault(); cerrar(e.target); } }, true);
  doc.addEventListener("mousedown", function (e) {
    var d = e.target;
    if (d && d.matches && d.matches("dialog.cr-hoja[open]")) {
      var r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cerrar(d);
    }
  });

  // ---------- avisos ----------
  var zona = null;
  function aviso(texto, op) {
    op = op || {};
    if (!zona) { zona = doc.createElement("div"); zona.className = "cr-avisos"; zona.setAttribute("role", "status"); zona.setAttribute("aria-live", "polite"); doc.body.appendChild(zona); }
    var el = doc.createElement("div");
    el.className = "cr-aviso" + (op.tipo ? " " + op.tipo : "");
    var punto = doc.createElement("i"); var t = doc.createElement("span"); t.textContent = texto;
    el.appendChild(punto); el.appendChild(t);
    var quitar = function () {
      if (el.classList.contains("cr-cerrando")) return;
      if (menosMovimiento()) return el.remove();
      el.classList.add("cr-cerrando"); el.addEventListener("animationend", function () { el.remove(); }, { once: true }); setTimeout(function () { el.remove(); }, 400);
    };
    if (op.accion) { var b = doc.createElement("button"); b.type = "button"; b.textContent = op.accion; b.onclick = function () { try { op.alAccion && op.alAccion(); } finally { quitar(); } }; el.appendChild(b); }
    zona.appendChild(el);
    while (zona.children.length > 3) zona.firstElementChild.remove();
    setTimeout(quitar, op.ms || (op.accion ? 6000 : 3600));
    return quitar;
  }

  // ---------- transiciones entre vistas ----------
  function transicion(cambio) {
    if (!doc.startViewTransition || menosMovimiento()) { cambio(); return Promise.resolve(); }
    return doc.startViewTransition(cambio).finished.catch(function () {});
  }

  // ---------- control segmentado: la píldora se desliza ----------
  function ubicarSegmentado(s) {
    var marcado = s.querySelector("input:checked");
    var lab = marcado && marcado.closest("label");
    if (!lab) return;
    s.style.setProperty("--cr-seg-x", lab.offsetLeft + "px");
    s.style.setProperty("--cr-seg-ancho", lab.offsetWidth + "px");
    s.setAttribute("data-cr-listo", "");
  }
  doc.addEventListener("change", function (e) { var s = e.target.closest && e.target.closest(".cr-segmentado"); if (s) ubicarSegmentado(s); });

  // ---------- pestañas ----------
  function elegirPestana(btn) {
    var cont = btn.closest(".cr-pestanas"); if (!cont) return;
    var id = btn.getAttribute("aria-controls");
    cont.querySelectorAll(".cr-pestanas-lista button").forEach(function (b) { var si = b === btn; b.setAttribute("aria-selected", String(si)); b.tabIndex = si ? 0 : -1; });
    cont.querySelectorAll(":scope > [role=tabpanel]").forEach(function (p) { p.hidden = p.id !== id; });
  }
  doc.addEventListener("keydown", function (e) {
    var btn = e.target.closest && e.target.closest(".cr-pestanas-lista button");
    if (!btn || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    var todos = Array.prototype.slice.call(btn.parentElement.querySelectorAll("button"));
    var sig = todos[(todos.indexOf(btn) + (e.key === "ArrowRight" ? 1 : todos.length - 1)) % todos.length];
    sig.focus(); elegirPestana(sig);
  });

  // ---------- clics declarativos ----------
  doc.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var a = t.closest("[data-cr-abrir]"); if (a) { e.preventDefault(); abrir(a.getAttribute("data-cr-abrir")); return; }
    var c = t.closest("[data-cr-cerrar]"); if (c) { e.preventDefault(); cerrar(c.closest("dialog") || c.getAttribute("data-cr-cerrar")); return; }
    var tm = t.closest("[data-cr-tema]"); if (tm) { var v = tm.getAttribute("data-cr-tema"); tema(v && v !== "alternar" ? v : (esOscuro() ? "claro" : "oscuro")); return; }
    var m = t.closest("[data-cr-menu]"); if (m) { var app = m.closest(".cr-app") || doc.querySelector(".cr-app"); if (app) app.classList.toggle("menu-abierto"); return; }
    var p = t.closest(".cr-pestanas-lista button"); if (p) { elegirPestana(p); return; }
    var item = t.closest(".cr-app.menu-abierto .cr-menu-item"); if (item) item.closest(".cr-app").classList.remove("menu-abierto");
  });

  // ---------- revelar al hacer scroll (si el navegador no lo hace solo con CSS) ----------
  var porScroll = window.CSS && CSS.supports && CSS.supports("animation-timeline: view()");
  var observador = null;
  if (!porScroll && "IntersectionObserver" in window) {
    observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) { if (en.isIntersecting) { en.target.classList.remove("cr-pendiente"); en.target.classList.add("cr-visto"); observador.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: .08 });
  }
  function preparar(base) {
    (base || doc).querySelectorAll(".cr-segmentado").forEach(ubicarSegmentado);
    (base || doc).querySelectorAll(".cr-pestanas").forEach(function (c) {
      var bs = c.querySelectorAll(".cr-pestanas-lista button"); if (!bs.length) return;
      var act = c.querySelector('.cr-pestanas-lista button[aria-selected="true"]') || bs[0];
      c.querySelector(".cr-pestanas-lista").setAttribute("role", "tablist");
      bs.forEach(function (b) { b.setAttribute("role", "tab"); b.type = "button"; });
      if (!c.hasAttribute("data-cr-listo")) { c.setAttribute("data-cr-listo", ""); elegirPestana(act); }
    });
    if (observador && !menosMovimiento()) {
      (base || doc).querySelectorAll(".cr-revela:not(.cr-visto):not(.cr-pendiente)").forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * .92) { el.classList.add("cr-visto"); return; } // ya visible: no se esconde
        el.classList.add("cr-pendiente"); observador.observe(el);
      });
    }
  }
  function iniciar() {
    preparar(doc);
    var pendiente = false;
    new MutationObserver(function (cambios) {
      if (pendiente) return;
      for (var i = 0; i < cambios.length; i++) if (cambios[i].addedNodes.length) {
        pendiente = true; requestAnimationFrame(function () { pendiente = false; preparar(doc); }); break;
      }
    }).observe(doc.body, { childList: true, subtree: true });
    var espera; window.addEventListener("resize", function () { clearTimeout(espera); espera = setTimeout(function () { doc.querySelectorAll(".cr-segmentado").forEach(ubicarSegmentado); }, 120); });
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", iniciar); else iniciar();

  window.cristal = { aviso: aviso, abrir: abrir, cerrar: cerrar, tema: tema, transicion: transicion, preparar: preparar, version: "0.1.0" };
})();
