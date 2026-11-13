package automatizacion.nucleo;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Corre la automatización: candado, configuración, registro, historial y avisos. */
public final class Ejecutor {
    private Ejecutor() {}

    public static int ejecutar(String nombre, Tarea.Logica logica, boolean prueba, boolean forzar) {
        Path raiz = Path.of(System.getProperty("automatizacion.raiz", ".")).toAbsolutePath().normalize();
        Config cfg = new Config(raiz);
        prueba = prueba || cfg.activo("MODO_PRUEBA");
        String ejecucion = UUID.randomUUID().toString().substring(0, 8);
        Registro log = new Registro(raiz.resolve("logs"), cfg.secretos(), ejecucion);
        Path candado = raiz.resolve("datos").resolve("ejecucion.lock");
        if (!bloquear(candado)) {
            log.aviso("ya hay una ejecución en curso; esta se omite", Map.of());
            return 0;
        }
        LocalDateTime inicio = LocalDateTime.now().truncatedTo(ChronoUnit.SECONDS);
        Map<String, Object> registro = new LinkedHashMap<>();
        registro.put("ejecucion", ejecucion);
        registro.put("automatizacion", nombre);
        registro.put("inicio", inicio.toString());
        registro.put("modo", prueba ? "prueba" : "real");
        Contexto ctx = null;
        int codigo = 0;
        try {
            Estado estado = new Estado(raiz.resolve("datos").resolve("estado.tsv"));
            ctx = new Contexto(nombre, prueba, forzar, log, estado, cfg);
            List<String> falta = cfg.faltantes(logica.variablesRequeridas());
            if (!falta.isEmpty()) throw new IllegalStateException("faltan variables en .env: " + String.join(", ", falta) + " (ver .env.example)");
            log.info("inicia la automatización", Map.of("modo", registro.get("modo")));
            logica.ejecutar(ctx);
            registro.put("estado", "ok");
            log.info("terminó bien", ctx.resultado());
        } catch (Throwable e) {
            codigo = 1;
            registro.put("estado", "error");
            registro.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            StringWriter traza = new StringWriter();
            e.printStackTrace(new PrintWriter(traza));
            String t = traza.toString();
            log.error("la automatización falló", Map.of("error", registro.get("error"), "traza", t.length() > 2000 ? t.substring(0, 2000) : t));
        } finally {
            LocalDateTime fin = LocalDateTime.now().truncatedTo(ChronoUnit.SECONDS);
            registro.put("fin", fin.toString());
            registro.put("segundos", Duration.between(inicio, LocalDateTime.now()).toMillis() / 100 / 10.0);
            registro.put("pasos", ctx == null ? List.of() : ctx.pasos);
            registro.put("resultado", ctx == null ? Map.of() : ctx.resultado());
            try {
                Files.createDirectories(raiz.resolve("logs"));
                Files.writeString(raiz.resolve("logs").resolve("ejecuciones.jsonl"), log.limpio(Json.escribir(registro)) + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            } catch (IOException e) {
                System.err.println("no pude guardar el historial: " + e.getMessage());
            }
            try { Files.deleteIfExists(candado); } catch (IOException ignored) {}
        }
        boolean falla = "error".equals(registro.get("estado"));
        if ((falla || cfg.activo("AVISAR_EXITO")) && !prueba) {
            String titulo = (falla ? "❌ " : "✅ ") + nombre + " (" + registro.get("segundos") + " s)";
            Avisos.avisar(cfg, log, titulo, log.limpio(falla ? String.valueOf(registro.get("error")) : Json.escribir(registro.get("resultado"))));
        }
        return codigo;
    }

    /** Evita dos ejecuciones simultáneas; un candado de más de 6 horas se considera abandonado. */
    private static boolean bloquear(Path candado) {
        try {
            Files.createDirectories(candado.getParent());
            Files.writeString(candado, String.valueOf(ProcessHandle.current().pid()), StandardOpenOption.CREATE_NEW);
            return true;
        } catch (FileAlreadyExistsException e) {
            try {
                if (Files.getLastModifiedTime(candado).toInstant().isBefore(Instant.now().minus(Duration.ofHours(6)))) {
                    Files.deleteIfExists(candado);
                    return bloquear(candado);
                }
            } catch (IOException ignored) {}
            return false;
        } catch (IOException e) {
            throw new IllegalStateException("no pude crear el candado: " + e.getMessage(), e);
        }
    }
}
