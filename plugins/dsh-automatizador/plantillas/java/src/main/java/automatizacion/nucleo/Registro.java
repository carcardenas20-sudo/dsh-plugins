package automatizacion.nucleo;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Log en consola (legible) y en logs/AAAA-MM-DD.jsonl (para analizar). Oculta secretos. */
public final class Registro {
    private final Path archivo;
    private final List<String> secretos;
    private final String ejecucion;
    String paso;

    public Registro(Path carpeta, List<String> secretos, String ejecucion) {
        try { Files.createDirectories(carpeta); } catch (IOException e) { throw new IllegalStateException(e); }
        this.archivo = carpeta.resolve(LocalDate.now() + ".jsonl");
        this.secretos = secretos;
        this.ejecucion = ejecucion;
    }

    String limpio(String t) {
        for (String s : secretos) t = t.replace(s, "***");
        return t;
    }

    private synchronized void escribir(String nivel, String mensaje, Map<String, ?> datos) {
        String ahora = LocalDateTime.now().truncatedTo(ChronoUnit.SECONDS).toString();
        Map<String, Object> fila = new LinkedHashMap<>();
        fila.put("t", ahora);
        fila.put("nivel", nivel);
        fila.put("ejecucion", ejecucion);
        fila.put("paso", paso);
        fila.put("msg", mensaje);
        if (datos != null && !datos.isEmpty()) fila.put("datos", datos);
        String linea = limpio(Json.escribir(fila));
        try {
            Files.writeString(archivo, linea + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            System.err.println("no pude escribir el log: " + e.getMessage());
        }
        StringBuilder sb = new StringBuilder(ahora).append(' ').append(String.format("%-5s", nivel.toUpperCase())).append(' ');
        if (paso != null) sb.append('[').append(paso).append("] ");
        sb.append(mensaje);
        if (datos != null) datos.forEach((k, v) -> sb.append(' ').append(k).append('=').append(v));
        (nivel.equals("error") ? System.err : System.out).println(limpio(sb.toString()));
    }

    public void info(String m) { escribir("info", m, null); }
    public void info(String m, Map<String, ?> d) { escribir("info", m, d); }
    public void aviso(String m, Map<String, ?> d) { escribir("aviso", m, d); }
    public void error(String m, Map<String, ?> d) { escribir("error", m, d); }
}
