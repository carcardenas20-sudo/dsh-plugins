package escritorio;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.function.BiFunction;

/**
 * Servidor local de la app (solo 127.0.0.1): entrega la interfaz, el panel de automatizaciones, las capturas de los
 * robots y el puente con Java (/_escritorio/llamar y los eventos en /_escritorio/eventos). Cada pedido al puente lleva
 * una clave que solo conoce la página, así otra web o programa del PC no puede usarlo.
 */
final class Servidor {
    private final HttpServer http;
    final int puerto;
    final String token;
    private final Path web, capturas;
    private final String info;
    private final BiFunction<String, List<Object>, Object> atender;
    private final List<OutputStream> oyentes = new CopyOnWriteArrayList<>();

    Servidor(int base, String token, Path web, Path capturas, String info, BiFunction<String, List<Object>, Object> atender) throws Exception {
        this.token = token; this.web = web; this.capturas = capturas; this.info = info; this.atender = atender;
        HttpServer h = null;
        int p = base;
        // el puerto fijo por app mantiene los datos guardados de la página (van por dirección); si está ocupado, el siguiente
        for (int i = 0; i < 30 && h == null; i++) {
            try { h = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), base + i), 64); p = base + i; } catch (Exception ignored) { }
        }
        if (h == null) throw new Exception("No hay puerto libre para la app");
        this.http = h; this.puerto = p;
        http.setExecutor(Executors.newCachedThreadPool(r -> { Thread t = new Thread(r, "servidor"); t.setDaemon(true); return t; }));
        http.createContext("/", this::atenderPedido);
        http.start();
    }

    String direccion() { return "http://127.0.0.1:" + puerto + "/"; }

    void emitir(String evento, Object datos) {
        byte[] b = ("data: " + Json.escribir(Json.mapa("evento", evento, "datos", datos)) + "\n\n").getBytes(StandardCharsets.UTF_8);
        for (OutputStream o : oyentes) {
            try { synchronized (o) { o.write(b); o.flush(); } } catch (Exception e) { oyentes.remove(o); }
        }
    }

    private static void responder(HttpExchange x, int codigo, String tipo, byte[] cuerpo) throws java.io.IOException {
        x.getResponseHeaders().set("Content-Type", tipo);
        x.getResponseHeaders().set("Cache-Control", "no-store");
        x.sendResponseHeaders(codigo, cuerpo.length == 0 ? -1 : cuerpo.length);
        if (cuerpo.length > 0) try (OutputStream o = x.getResponseBody()) { o.write(cuerpo); }
        x.close();
    }

    private static String tipo(String n) {
        n = n.toLowerCase();
        if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html; charset=utf-8";
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".json") || n.endsWith(".map")) return "application/json";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".ico")) return "image/x-icon";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".woff")) return "font/woff";
        if (n.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    private void atenderPedido(HttpExchange x) throws java.io.IOException {
        try {
            String host = String.valueOf(x.getRequestHeaders().getFirst("Host"));
            if (!host.equals("127.0.0.1:" + puerto) && !host.equals("localhost:" + puerto)) { responder(x, 403, "text/plain", "No permitido".getBytes()); return; }
            String ruta = URLDecoder.decode(x.getRequestURI().getRawPath(), StandardCharsets.UTF_8);
            if (ruta.equals("/_escritorio/llamar") && "POST".equals(x.getRequestMethod())) {
                if (!token.equals(x.getRequestHeaders().getFirst("x-escritorio"))) { responder(x, 403, "application/json", "{\"ok\":false,\"error\":\"no permitido\"}".getBytes()); return; }
                Map<String, Object> m = Json.objeto(Json.leer(new String(x.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
                Map<String, Object> r;
                try { r = Json.mapa("ok", true, "valor", atender.apply(Json.texto(m.get("metodo")), Json.lista(m.get("args")))); }
                catch (Exception e) { r = Json.mapa("ok", false, "error", e.getMessage() == null ? e.toString() : e.getMessage()); }
                responder(x, 200, "application/json", Json.escribir(r).getBytes(StandardCharsets.UTF_8));
                return;
            }
            if (ruta.equals("/_escritorio/eventos")) {
                String q = String.valueOf(x.getRequestURI().getQuery());
                if (!q.contains("t=" + token)) { responder(x, 403, "text/plain", new byte[0]); return; }
                x.getResponseHeaders().set("Content-Type", "text/event-stream");
                x.getResponseHeaders().set("Cache-Control", "no-store");
                x.sendResponseHeaders(200, 0);
                OutputStream o = x.getResponseBody();
                o.write(": hola\n\n".getBytes()); o.flush();
                oyentes.add(o);
                return; // queda abierto
            }
            if (ruta.equals("/_escritorio/puente.js")) {
                try (InputStream in = Servidor.class.getResourceAsStream("/escritorio/puente.js")) { responder(x, 200, "text/javascript; charset=utf-8", in.readAllBytes()); }
                return;
            }
            if (ruta.startsWith("/_datos/")) {
                Path f = capturas.resolve(Path.of(ruta.substring(8)).getFileName().toString()).normalize();
                if (f.startsWith(capturas) && Files.isRegularFile(f)) responder(x, 200, tipo(f.toString()), Files.readAllBytes(f)); else responder(x, 404, "text/plain", new byte[0]);
                return;
            }
            Path f = web.resolve(ruta.substring(1)).normalize();
            if (!f.startsWith(web)) { responder(x, 403, "text/plain", new byte[0]); return; }
            if (Files.isDirectory(f)) f = f.resolve("index.html");
            if (!Files.isRegularFile(f)) {
                if (ruta.matches(".*\\.[a-zA-Z0-9]{1,5}$")) { responder(x, 404, "text/plain", "No existe".getBytes()); return; }
                f = web.resolve("index.html"); // rutas de una SPA (React Router) → index.html
            }
            byte[] b = Files.readAllBytes(f);
            if (f.toString().endsWith(".html")) {
                // el puente va antes que cualquier script de la página
                String html = new String(b, StandardCharsets.UTF_8);
                String inyectar = "<script>window.__ESCRITORIO_INFO__=" + info + ";</script><script src=\"/_escritorio/puente.js\"></script>";
                int i = html.toLowerCase().indexOf("<head");
                int fin = i >= 0 ? html.indexOf('>', i) + 1 : 0;
                b = (html.substring(0, fin) + inyectar + html.substring(fin)).getBytes(StandardCharsets.UTF_8);
            }
            responder(x, 200, tipo(f.toString()), b);
        } catch (Exception e) {
            try { responder(x, 500, "text/plain", String.valueOf(e.getMessage()).getBytes(StandardCharsets.UTF_8)); } catch (Exception ignored) { }
        }
    }

    void detener() { http.stop(0); }
}
