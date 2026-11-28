package escritorio;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.Function;

/** Motor de automatizaciones: el Node que viaja con la app corre recursos/motor/servidor.cjs; hablan con una línea JSON por mensaje. */
public final class Motor {
    private final Process proceso;
    private final Writer entrada;
    private final Map<Long, CompletableFuture<Map<String, Object>>> esperando = new ConcurrentHashMap<>();
    private final AtomicLong contador = new AtomicLong();

    private Motor(Process p) {
        this.proceso = p;
        this.entrada = new OutputStreamWriter(p.getOutputStream(), StandardCharsets.UTF_8);
    }

    static Path rutaNode(Path recursos) {
        String n = System.getProperty("os.name").toLowerCase().contains("win") ? "node.exe" : "node";
        Path p = recursos.resolve(n);
        return Files.exists(p) ? p : Path.of(n);
    }

    /** eventos(m): lista, notificar, interfaz, error · pedidos(m) → valor (datos privados) */
    static Motor iniciar(Path recursos, Path datos, String equipo, Consumer<Map<String, Object>> eventos, Function<Map<String, Object>, Object> pedidos) throws Exception {
        Path script = recursos.resolve("motor").resolve("servidor.cjs");
        if (!Files.exists(script) || !Files.isDirectory(recursos.resolve("automatizaciones"))) return null;
        Files.createDirectories(datos);
        ProcessBuilder pb = new ProcessBuilder(rutaNode(recursos).toString(), script.toString(), recursos.toString(), datos.resolve("automatizaciones").toString());
        pb.environment().put("DSH_EQUIPO", equipo);
        pb.redirectError(ProcessBuilder.Redirect.appendTo(datos.resolve("motor-salida.log").toFile()));
        Motor m = new Motor(pb.start());
        Thread t = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(m.proceso.getInputStream(), StandardCharsets.UTF_8))) {
                String linea;
                while ((linea = r.readLine()) != null) {
                    Map<String, Object> v;
                    try { v = Json.objeto(Json.leer(linea)); } catch (Exception e) { continue; }
                    if (v.get("id") instanceof Number n) {
                        CompletableFuture<Map<String, Object>> f = m.esperando.remove(n.longValue());
                        if (f != null) f.complete(v);
                    } else if (v.containsKey("pedido")) {
                        Object valor = null;
                        try { valor = pedidos.apply(v); } catch (Exception ignored) { }
                        m.escribir(Json.mapa("respuesta", v.get("pedido"), "valor", valor));
                    } else eventos.accept(v);
                }
            } catch (Exception ignored) { }
        }, "motor-lector");
        t.setDaemon(true);
        t.start();
        return m;
    }

    private synchronized void escribir(Object m) throws Exception {
        entrada.write(Json.escribir(m) + "\n");
        entrada.flush();
    }

    public Object llamar(String metodo, List<Object> args, long segundos) throws Exception {
        long id = contador.incrementAndGet();
        CompletableFuture<Map<String, Object>> f = new CompletableFuture<>();
        esperando.put(id, f);
        escribir(Json.mapa("id", id, "metodo", metodo, "args", args));
        Map<String, Object> r;
        try { r = f.get(segundos, TimeUnit.SECONDS); } catch (Exception e) { esperando.remove(id); throw new Exception("El motor de automatizaciones no respondió"); }
        if (Boolean.TRUE.equals(r.get("ok"))) return r.get("valor");
        throw new Exception(Json.texto(r.get("error")));
    }

    public void detener() {
        try { escribir(Json.mapa("id", 0, "metodo", "salir")); } catch (Exception ignored) { }
        try { proceso.waitFor(1, TimeUnit.SECONDS); } catch (Exception ignored) { }
        proceso.destroy();
    }

    static void anotar(Path archivo, String linea) {
        try { Files.createDirectories(archivo.getParent()); Files.writeString(archivo, linea + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND); } catch (Exception ignored) { }
    }
}
