package automatizacion.nucleo;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Lee .env y variables del sistema/servidor (estas mandan sobre .env). */
public final class Config {
    private static final String[] SECRETO = {"PASS", "CLAVE", "TOKEN", "SECRET", "KEY", "API"};
    private final Map<String, String> valores = new HashMap<>();

    public Config(Path raiz) {
        Path env = raiz.resolve(".env");
        if (Files.exists(env)) {
            try {
                for (String linea : Files.readAllLines(env, StandardCharsets.UTF_8)) {
                    linea = linea.strip();
                    if (linea.isEmpty() || linea.startsWith("#") || !linea.contains("=")) continue;
                    String k = linea.substring(0, linea.indexOf('=')).strip();
                    String v = linea.substring(linea.indexOf('=') + 1).strip();
                    if (v.length() >= 2 && v.charAt(0) == v.charAt(v.length() - 1) && (v.charAt(0) == '"' || v.charAt(0) == '\'')) v = v.substring(1, v.length() - 1);
                    valores.put(k, v);
                }
            } catch (IOException e) {
                throw new IllegalStateException("no pude leer .env: " + e.getMessage(), e);
            }
        }
        valores.putAll(System.getenv());
    }

    public String obtener(String clave) { return valores.get(clave); }

    public String obtener(String clave, String defecto) { return valores.getOrDefault(clave, defecto); }

    public boolean activo(String clave) {
        String v = valores.getOrDefault(clave, "").toLowerCase();
        return v.equals("1") || v.equals("true") || v.equals("si") || v.equals("sí");
    }

    public List<String> faltantes(List<String> requeridas) {
        List<String> f = new ArrayList<>();
        for (String k : requeridas) if (valores.get(k) == null || valores.get(k).isBlank()) f.add(k);
        return f;
    }

    public List<String> secretos() {
        List<String> s = new ArrayList<>();
        for (Map.Entry<String, String> e : valores.entrySet()) {
            String k = e.getKey().toUpperCase();
            for (String marca : SECRETO) {
                if (k.contains(marca) && e.getValue() != null && e.getValue().length() >= 4) { s.add(e.getValue()); break; }
            }
        }
        return s;
    }
}
