package automatizacion;

import automatizacion.nucleo.Contexto;
import automatizacion.nucleo.Tarea.Logica;

import java.util.List;
import java.util.Map;

/**
 * Lógica de negocio de {{NOMBRE}}: {{DESCRIPCION}}
 *
 * Escribe aquí SOLO lo propio de esta automatización. El núcleo ya resuelve:
 * configuración (.env), registro, reintentos, modo prueba, no repetir trabajo,
 * avisos y el historial de ejecuciones.
 *
 * Herramientas del contexto (ctx):
 *   ctx.paso("nombre", () -> { ... })               agrupa y registra un paso (duración y error)
 *   var x = ctx.pasoCon("nombre", () -> valor)      igual, devolviendo un valor
 *   ctx.reintentar(() -> ..., 4, 2000)              reintenta con espera creciente
 *   ctx.yaHecho(clave) / ctx.marcar(clave, detalle) no procesar dos veces lo mismo
 *   ctx.prueba()                                    true en --prueba: NO enviar ni modificar nada externo
 *   ctx.config("NOMBRE_VARIABLE")                   leer configuración / secretos del .env
 *   ctx.log().info("mensaje", Map.of("dato", x))    registro estructurado
 *   ctx.resultado().put("clave", valor)             resumen para el historial y el aviso
 */
public final class Tarea implements Logica {

    /** Variables que DEBEN existir en .env (falla de entrada si falta alguna). */
    @Override
    public List<String> variablesRequeridas() {
        return List.of({{VARIABLES}});
    }

    @Override
    public void ejecutar(Contexto ctx) throws Exception {
        List<Map<String, Object>> registros = ctx.pasoCon("obtener datos", () -> {
            // Ejemplo: reemplazar por la descarga/consulta real.
            List<Map<String, Object>> datos = ctx.reintentar(() -> List.of(
                    Map.<String, Object>of("id", "1", "valor", 10),
                    Map.<String, Object>of("id", "2", "valor", 20)));
            ctx.log().info("datos obtenidos", Map.of("cantidad", datos.size()));
            return datos;
        });

        int[] procesados = {0};
        ctx.paso("procesar", () -> {
            for (Map<String, Object> r : registros) {
                String clave = "registro:" + r.get("id");
                if (ctx.yaHecho(clave)) continue;
                if (ctx.prueba()) {
                    ctx.log().info("modo prueba: se procesaría", Map.of("id", r.get("id")));
                    continue;
                }
                // Acción real (enviar, guardar, llenar formulario…) va aquí, con ctx.reintentar si es externa.
                ctx.marcar(clave, "valor=" + r.get("valor"));
                procesados[0]++;
            }
        });
        ctx.resultado().put("procesados", procesados[0]);
    }
}
