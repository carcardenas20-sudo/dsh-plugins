package automatizacion.nucleo;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/** Herramientas para la lógica de negocio. */
public final class Contexto {
    private final String nombre;
    private final boolean prueba;
    private final boolean forzar;
    private final Registro log;
    private final Estado estado;
    private final Config config;
    final List<Map<String, Object>> pasos = new ArrayList<>();
    private final Map<String, Object> resultado = new LinkedHashMap<>();

    Contexto(String nombre, boolean prueba, boolean forzar, Registro log, Estado estado, Config config) {
        this.nombre = nombre; this.prueba = prueba; this.forzar = forzar; this.log = log; this.estado = estado; this.config = config;
    }

    public String nombre() { return nombre; }
    public boolean prueba() { return prueba; }
    public Registro log() { return log; }
    public Map<String, Object> resultado() { return resultado; }

    /** Lee una variable del .env o del servidor; falla con mensaje claro si no existe. */
    public String config(String clave) {
        String v = config.obtener(clave);
        if (v == null) throw new IllegalStateException("falta la variable " + clave + " en .env");
        return v;
    }

    public String config(String clave, String defecto) { return config.obtener(clave, defecto); }

    /** Paso que no devuelve nada: ctx.paso("enviar", () -> { ... }); */
    public void paso(String nombre, Tarea.Bloque bloque) throws Exception {
        pasoCon(nombre, () -> { bloque.correr(); return null; });
    }

    /** Paso que devuelve un valor: var datos = ctx.pasoCon("descargar", () -> descargar()); */
    public <T> T pasoCon(String nombre, Tarea.Accion<T> accion) throws Exception {
        String anterior = log.paso;
        log.paso = nombre;
        long t0 = System.nanoTime();
        log.info("inicia");
        Map<String, Object> fila = new LinkedHashMap<>();
        fila.put("paso", nombre);
        try {
            T r = accion.llamar();
            fila.put("ok", true);
            fila.put("segundos", seg(t0));
            log.info("termina", Map.of("segundos", seg(t0)));
            return r;
        } catch (Exception e) {
            fila.put("ok", false);
            fila.put("segundos", seg(t0));
            fila.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            log.error("falló", Map.of("error", e.getClass().getSimpleName() + ": " + e.getMessage()));
            throw e;
        } finally {
            pasos.add(fila);
            log.paso = anterior;
        }
    }

    private static double seg(long t0) { return Math.round((System.nanoTime() - t0) / 1e7) / 100.0; }

    /** Llama la acción; si falla, reintenta con espera creciente (2s, 4s, 8s… + azar). */
    public <T> T reintentar(Tarea.Accion<T> accion, int intentos, long esperaMs) throws Exception {
        for (int n = 1; ; n++) {
            try {
                return accion.llamar();
            } catch (Exception e) {
                if (n >= intentos) throw e;
                long pausa = Math.min(60_000, esperaMs * (1L << (n - 1))) + ThreadLocalRandom.current().nextLong(500);
                log.aviso("reintento", Map.of("intento", n, "de", intentos, "espera_ms", pausa, "error", e.getClass().getSimpleName() + ": " + e.getMessage()));
                Thread.sleep(pausa);
            }
        }
    }

    public <T> T reintentar(Tarea.Accion<T> accion) throws Exception { return reintentar(accion, 4, 2000); }

    public boolean yaHecho(String clave) { return !forzar && estado.yaHecho(clave); }

    /** Marca como hecho (en modo prueba no guarda nada). */
    public void marcar(String clave, String detalle) { if (!prueba) estado.marcar(clave, detalle); }
}
