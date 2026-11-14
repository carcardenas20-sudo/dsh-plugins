// Ejemplo realista (lo que escribiría el agente) para probar el kit de dsh-lienzo.
export const titulo = 'Pantalla de cola del biometrador'
export const cuerpo = `<div class="lz-pagina">
  <header class="lz-encabezado">
    <p class="lz-antetitulo">Recorrido del usuario · Modo manual de práctica</p>
    <h1>Pantalla de cola del biometrador</h1>
    <p class="lz-entrada">Qué ve la pantalla, qué hace cada persona y qué registra AULAPP en los 5 pasos de una sesión con kit asignado.</p>
    <div class="lz-meta"><span>⏱ Secuencia de 90 s</span><span>🧰 Kit por sesión</span><span>↔ Desfase par / impar</span><span>👥 Plantilla 3 + 3</span></div>
  </header>

  <section class="lz-seccion">
    <div class="lz-kpis">
      <div class="lz-kpi"><div class="valor">90 s</div><div class="etiqueta">Tiempo máximo por sesión en el puesto</div></div>
      <div class="lz-kpi"><div class="valor">3 + 3</div><div class="etiqueta">Aprendices por turno (par e impar)</div></div>
      <div class="lz-kpi"><div class="valor">2</div><div class="etiqueta">Intentos de rostro antes de pasar a manual</div></div>
      <div class="lz-kpi"><div class="valor">1 kit</div><div class="etiqueta">Asignado a cada sesión, no a cada aprendiz</div></div>
    </div>
  </section>

  <section class="lz-seccion">
    <h2>La sesión paso a paso</h2>
    <p class="lz-desc">Cada tarjeta muestra la pantalla del puesto en ese momento. Desliza para ver los 5 pasos.</p>
    <div class="lz-storyboard"><div class="lz-storyboard-pista">
      <article class="lz-escena">
        <div class="lz-escena-cab"><span class="lz-num">0</span><h3>Sesión en cola</h3><span class="lz-tiempo">antes</span></div>
        <div class="lz-escena-vista"><div class="lz-pantalla kiosco"><div class="lz-ui-barra">Biometrador <small>Puesto 2</small></div>
          <div class="lz-ui-cuerpo"><div class="lz-ui-titulo">Próximas sesiones</div>
            <ul class="lz-ui-lista"><li class="activo">07:00 · Par <span class="lz-chip ok">Lista</span></li><li>07:15 · Impar <span class="lz-chip aviso">Cola</span></li><li>07:30 · Par <span class="lz-chip">Cola</span></li></ul>
            <div class="lz-ui-texto">Kit A asignado a la sesión par.</div></div></div></div>
        <div class="lz-escena-texto"><dl>
          <div><dt>Persona</dt><dd>Nadie interactúa: la pantalla muestra la cola del día.</dd></div>
          <div><dt>AULAPP</dt><dd>Ordena las sesiones con el desfase par/impar y reserva el kit.</dd></div></dl></div>
      </article>
      <article class="lz-escena">
        <div class="lz-escena-cab"><span class="lz-num">1</span><h3>Login</h3><span class="lz-tiempo">0–15 s</span></div>
        <div class="lz-escena-vista"><div class="lz-pantalla kiosco"><div class="lz-ui-barra">Biometrador <small>07:00 · Par</small></div>
          <div class="lz-ui-cuerpo"><div class="lz-ui-centro"><div class="lz-ui-titulo">Instructor, ingresa tu documento</div>
            <div class="lz-ui-campo">C.C. ••••••••</div><span class="lz-ui-boton">Continuar</span></div></div></div></div>
        <div class="lz-escena-texto"><dl>
          <div><dt>Persona</dt><dd>El instructor digita su documento.</dd></div>
          <div><dt>AULAPP</dt><dd>Verifica que tenga asignada esta sesión.</dd></div></dl></div>
      </article>
      <article class="lz-escena">
        <div class="lz-escena-cab"><span class="lz-num">2</span><h3>Cara del instructor</h3><span class="lz-tiempo">15–30 s</span></div>
        <div class="lz-escena-vista"><div class="lz-pantalla kiosco"><div class="lz-ui-barra">Biometrador <small>07:00 · Par</small></div>
          <div class="lz-ui-cuerpo"><div class="lz-ui-centro"><div class="lz-ui-camara">🙂</div><div class="lz-ui-titulo">Mira a la cámara</div>
            <div class="lz-ui-progreso" style="width:80%"><i style="--valor:60%"></i></div><div class="lz-ui-texto">Intento 1 de 2</div></div></div></div></div>
        <div class="lz-escena-texto"><dl>
          <div><dt>Persona</dt><dd>El instructor se ubica frente a la cámara.</dd></div>
          <div><dt>AULAPP</dt><dd>Compara el rostro; si falla dos veces, pasa a registro manual.</dd></div></dl></div>
      </article>
      <article class="lz-escena">
        <div class="lz-escena-cab"><span class="lz-num">3</span><h3>Cara del aprendiz</h3><span class="lz-tiempo">30–75 s</span></div>
        <div class="lz-escena-vista"><div class="lz-pantalla kiosco"><div class="lz-ui-barra">Biometrador <small>Aprendiz 2 de 3</small></div>
          <div class="lz-ui-cuerpo"><div class="lz-ui-centro"><div class="lz-ui-camara ok">✓</div><div class="lz-ui-titulo">Laura M. verificada</div>
            <div class="lz-ui-alerta ok">Siguiente aprendiz en 5 s</div></div></div></div></div>
        <div class="lz-escena-texto"><dl>
          <div><dt>Persona</dt><dd>Cada aprendiz de la plantilla pasa uno por uno.</dd></div>
          <div><dt>AULAPP</dt><dd>Marca la asistencia y vuelve a la cámara para el siguiente.</dd></div></dl></div>
      </article>
      <article class="lz-escena">
        <div class="lz-escena-cab"><span class="lz-num">4</span><h3>Inicio de la práctica</h3><span class="lz-tiempo">75–90 s</span></div>
        <div class="lz-escena-vista"><div class="lz-pantalla kiosco"><div class="lz-ui-barra">Biometrador <small>07:00 · Par</small></div>
          <div class="lz-ui-cuerpo"><div class="lz-ui-centro"><div class="lz-ui-temporizador">01:30</div><div class="lz-ui-titulo">Práctica iniciada</div>
            <div class="lz-ui-texto">3 de 3 presentes · Kit A</div><span class="lz-ui-boton secundario">Ver sesión</span></div></div></div></div>
        <div class="lz-escena-texto"><dl>
          <div><dt>Persona</dt><dd>Instructor y aprendices salen a la práctica con el kit.</dd></div>
          <div><dt>AULAPP</dt><dd>Abre la sesión, entrega el kit y libera el puesto para la impar.</dd></div></dl></div>
      </article>
    </div></div>
  </section>

  <section class="lz-seccion">
    <h2>Quién hace qué</h2>
    <p class="lz-desc">Las sesiones par e impar se cruzan: mientras una practica, la otra pasa por el biometrador.</p>
    <div class="lz-carriles">
      <div class="cab"></div><div class="cab">Cola</div><div class="cab">Identificación</div><div class="cab">Práctica</div>
      <div class="actor">Instructor</div><div class="vacio"></div><div>Login y rostro</div><div>Dirige la práctica</div>
      <div class="actor">Aprendices</div><div>Esperan su turno</div><div>Rostro uno por uno</div><div>Practican con el kit</div>
      <div class="actor">AULAPP</div><div>Ordena par/impar</div><div>Valida y marca asistencia</div><div>Cuenta tiempo y libera el kit</div>
    </div>
  </section>

  <div class="lz-nota aviso"><strong>Caso especial</strong><p>Si la cámara falla dos veces seguidas, el instructor registra al aprendiz manualmente y queda marcado para auditoría.</p></div>
</div>`
