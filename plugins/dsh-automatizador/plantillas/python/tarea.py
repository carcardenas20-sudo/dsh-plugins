"""Lógica de negocio de {{NOMBRE}}: {{DESCRIPCION}}

Escribe aquí SOLO lo propio de esta automatización. El núcleo ya resuelve:
configuración (.env), registro, reintentos, modo prueba, no repetir trabajo,
avisos y el historial de ejecuciones.

Herramientas del contexto (ctx):
  with ctx.paso("nombre"):          # agrupa y registra un paso (duración y error)
  ctx.reintentar(funcion, intentos=4, espera=2)   # reintenta con espera creciente
  ctx.ya_hecho(clave) / ctx.marcar(clave, detalle)  # no procesar dos veces lo mismo
  ctx.prueba                         # True en --prueba: NO enviar ni modificar nada externo
  ctx.config("NOMBRE_VARIABLE")      # leer configuración / secretos del .env
  ctx.log.info("mensaje", dato=...)  # registro estructurado
  ctx.resultado["clave"] = valor     # resumen que queda en el historial y en el aviso
"""

# Variables que DEBEN existir en .env (la ejecución falla de entrada si falta alguna).
VARIABLES_REQUERIDAS = [{{VARIABLES}}]


def ejecutar(ctx):
    with ctx.paso("obtener datos"):
        # Ejemplo: reemplazar por la descarga/consulta real.
        registros = ctx.reintentar(lambda: [{"id": "1", "valor": 10}, {"id": "2", "valor": 20}])
        ctx.log.info("datos obtenidos", cantidad=len(registros))

    procesados = 0
    with ctx.paso("procesar"):
        for r in registros:
            clave = f"registro:{r['id']}"
            if ctx.ya_hecho(clave):
                continue
            if ctx.prueba:
                ctx.log.info("modo prueba: se procesaría", id=r["id"])
                continue
            # Acción real (enviar, guardar, llenar formulario…) va aquí, con ctx.reintentar si es externa.
            ctx.marcar(clave, f"valor={r['valor']}")
            procesados += 1

    ctx.resultado["procesados"] = procesados
