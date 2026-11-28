package escritorio;

import java.awt.MenuItem;
import java.awt.PopupMenu;
import java.awt.SystemTray;
import java.awt.TrayIcon;
import java.awt.image.BufferedImage;
import java.io.File;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.image.PixelReader;
import javafx.scene.image.WritableImage;
import javafx.scene.web.WebView;
import javafx.stage.FileChooser;
import javafx.stage.Stage;
import javax.imageio.ImageIO;

/**
 * App de escritorio con JavaFX (generada por dsh-escritorio): la interfaz web en un WebView, servida por Servidor.java,
 * con la misma API window.escritorio que las versiones Electron y Tauri (puente.js), bandeja del sistema,
 * automatizaciones (motor de Node), aviso de versión nueva, versión mínima obligatoria y datos privados cifrados.
 */
public class App extends Application {
    static Path base, web, recursos, datos;
    static Map<String, Object> config;
    static String version, equipo, nombre, id;
    static Path prueba;
    static Servidor servidor;
    static Motor motor;
    static Stage ventana, panel;
    static WebView vista, vistaPanel;
    static TrayIcon bandeja;
    static final Map<String, Object> actualizacion = new LinkedHashMap<>(Map.of("estado", "inactivo"));
    static final List<Object> errores = new ArrayList<>();
    static final AtomicBoolean bloqueada = new AtomicBoolean(false);
    static String avisada;
    static final ScheduledExecutorService reloj = Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "reloj"); t.setDaemon(true); return t; });
    static final HttpClient red = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).followRedirects(HttpClient.Redirect.NORMAL).build();

    public static void main(String[] args) {
        try {
            base = Path.of(App.class.getProtectionDomain().getCodeSource().getLocation().toURI()).getParent();
        } catch (Exception e) { base = Path.of("."); }
        web = base.resolve("web");
        recursos = base.resolve("recursos");
        try { config = Json.objeto(Json.leer(Files.readString(recursos.resolve("escritorio.config.json")))); } catch (Exception e) { config = new LinkedHashMap<>(); }
        nombre = String.valueOf(config.getOrDefault("nombre", "App"));
        id = String.valueOf(config.getOrDefault("id", "app.escritorio"));
        version = leerVersion();
        equipo = Json.texto(config, "equipo") != null ? Json.texto(config, "equipo") : Sistema.equipo();
        String p = System.getenv("DSH_ESCRITORIO_PRUEBA");
        prueba = p == null || p.isEmpty() ? null : Path.of(p);
        datos = prueba != null ? prueba.resolve("datos") : Sistema.carpetaDatos(nombre);
        try { Files.createDirectories(datos); } catch (Exception ignored) { }
        // los avisos del WebView al cortar la conexión de eventos (al cerrar o recargar) no son errores
        java.util.logging.Logger.getLogger("com.sun.webkit.network.URLLoader").setLevel(java.util.logging.Level.OFF);
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> registrarError("app", String.valueOf(e), stack(e)));
        if (prueba == null && !unaSolaInstancia()) { System.exit(0); return; }
        launch(App.class, args);
    }

    static String leerVersion() {
        try { return Files.readString(recursos.resolve("version.txt")).trim(); } catch (Exception e) { return "1.0.0"; }
    }

    static String stack(Throwable e) { java.io.StringWriter w = new java.io.StringWriter(); e.printStackTrace(new java.io.PrintWriter(w)); return w.toString(); }

    static void registrar(String m) { Motor.anotar(datos.resolve("app.log"), Instant.now() + " " + m); }

    static void registrarError(String origen, String mensaje, String detalle) {
        Map<String, Object> e = Json.mapa("origen", origen, "mensaje", mensaje.length() > 1000 ? mensaje.substring(0, 1000) : mensaje, "detalle", detalle == null ? "" : detalle.length() > 4000 ? detalle.substring(0, 4000) : detalle, "version", version, "equipo", equipo, "cuando", Instant.now().toString());
        Motor.anotar(datos.resolve("errores.log"), Json.escribir(e));
        synchronized (errores) { errores.add(e); if (errores.size() > 200) errores.remove(0); }
        if (servidor != null) servidor.emitir("error-app", e);
    }

    // ---------- una sola instancia: abrirla otra vez muestra la ventana que ya estaba ----------
    static FileLock candado;
    static boolean unaSolaInstancia() {
        try {
            FileChannel c = FileChannel.open(datos.resolve("instancia.lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
            candado = c.tryLock();
            if (candado != null) return true;
            String[] d = Files.readString(datos.resolve("instancia.txt")).trim().split(" ");
            HttpRequest r = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + d[0] + "/_escritorio/llamar")).header("x-escritorio", d[1]).header("content-type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"metodo\":\"mostrar\",\"args\":[]}")).build();
            red.send(r, HttpResponse.BodyHandlers.discarding());
        } catch (Exception ignored) { return true; }
        return false;
    }

    static int puertoBase() { return 20000 + Math.floorMod(id.hashCode(), 20000); }

    // ---------- arranque ----------
    @Override
    public void start(Stage escenario) throws Exception {
        Platform.setImplicitExit(false);
        byte[] b = new byte[24];
        new SecureRandom().nextBytes(b);
        String token = HexFormat.of().formatHex(b);
        Map<String, Object> info = Json.mapa("version", version, "equipo", equipo, "plataforma", Sistema.plataforma(), "token", token, "fotos", "/_datos/", "tecnologia", "java", "prueba", prueba != null);
        servidor = new Servidor(puertoBase(), token, web.toAbsolutePath().normalize(), datos.resolve("automatizaciones").resolve("capturas").toAbsolutePath().normalize(), Json.escribir(info), App::atender);
        try { Files.writeString(datos.resolve("instancia.txt"), servidor.puerto + " " + token); Sistema.soloUsuario(datos.resolve("instancia.txt")); } catch (Exception ignored) { }

        ventana = escenario;
        vista = new WebView();
        vista.getEngine().setUserDataDirectory(datos.resolve("webview").toFile());
        Map<String, Object> estado = new LinkedHashMap<>();
        try { estado = Json.objeto(Json.leer(Files.readString(datos.resolve("ventana.json")))); } catch (Exception ignored) { }
        double ancho = num(estado.get("ancho"), num(config.get("ancho"), 1280)), alto = num(estado.get("alto"), num(config.get("alto"), 820));
        escenario.setScene(new Scene(vista, ancho, alto));
        escenario.setMinWidth(num(config.get("minAncho"), 420));
        escenario.setMinHeight(num(config.get("minAlto"), 520));
        if (estado.get("x") instanceof Number x && estado.get("y") instanceof Number y) { escenario.setX(x.doubleValue()); escenario.setY(y.doubleValue()); }
        escenario.setTitle(nombre);
        try { escenario.getIcons().add(new javafx.scene.image.Image(base.resolve("icon.png").toUri().toString())); } catch (Exception ignored) { }
        vista.getEngine().titleProperty().addListener((o, a, t) -> { if (t != null && !t.isBlank()) escenario.setTitle(t); });
        vista.getEngine().load(Json.texto(config, "url") != null ? Json.texto(config, "url") : servidor.direccion());

        boolean conBandeja = !Boolean.FALSE.equals(config.get("bandeja")) && SystemTray.isSupported();
        escenario.setOnCloseRequest(ev -> {
            guardarVentana();
            if (conBandeja && bandeja != null) { ev.consume(); escenario.hide(); } else salir(0);
        });
        escenario.show();

        try {
            motor = Motor.iniciar(recursos, datos, equipo, App::eventoMotor, App::pedidoMotor);
        } catch (Exception e) { registrarError("app", "No arrancó el motor de automatizaciones: " + e.getMessage(), stack(e)); }
        if (conBandeja) crearBandeja();

        if (prueba != null) {
            int limite = motor != null ? 330 : 90;
            reloj.schedule(() -> { escribirResultado(Json.mapa("errores", List.of("la prueba superó " + limite + " s (¿la página no cargó?)"), "capturas", List.of())); salir(1); }, limite, TimeUnit.SECONDS);
        } else if (Json.texto(config, "sitio") != null || Json.ruta(config, "supabase", "url") != null) {
            reloj.scheduleWithFixedDelay(() -> revisarVersion(false), 4, 30 * 60, TimeUnit.SECONDS); // cada 30 min; la versión nueva se avisa una vez
        }
    }

    static double num(Object o, double d) { return o instanceof Number n ? n.doubleValue() : d; }

    static void guardarVentana() {
        if (ventana == null || ventana.isIconified()) return;
        try { Files.writeString(datos.resolve("ventana.json"), Json.escribir(Json.mapa("x", ventana.getX(), "y", ventana.getY(), "ancho", ventana.getScene().getWidth(), "alto", ventana.getScene().getHeight()))); } catch (Exception ignored) { }
    }

    static void mostrar() { Platform.runLater(() -> { ventana.show(); ventana.setIconified(false); ventana.toFront(); ventana.requestFocus(); }); }

    static void salir(int codigo) {
        try { if (motor != null) motor.detener(); } catch (Exception ignored) { }
        try { if (bandeja != null) SystemTray.getSystemTray().remove(bandeja); } catch (Exception ignored) { }
        try { servidor.detener(); } catch (Exception ignored) { }
        Platform.exit();
        System.exit(codigo);
    }

    static void crearBandeja() {
        try {
            BufferedImage img = ImageIO.read(base.resolve("icon.png").toFile());
            PopupMenu menu = new PopupMenu();
            MenuItem abrir = new MenuItem("Abrir"), autos = new MenuItem("Automatizaciones"), buscar = new MenuItem("Buscar actualizaciones"), cerrar = new MenuItem("Salir");
            abrir.addActionListener(e -> mostrar());
            autos.addActionListener(e -> abrirPanel(null));
            autos.setEnabled(motor != null);
            buscar.addActionListener(e -> new Thread(() -> revisarVersion(true)).start());
            cerrar.addActionListener(e -> salir(0));
            menu.add(abrir); menu.add(autos); menu.add(buscar); menu.addSeparator(); menu.add(cerrar);
            bandeja = new TrayIcon(img, nombre, menu);
            bandeja.setImageAutoSize(true);
            bandeja.addActionListener(e -> mostrar());
            SystemTray.getSystemTray().add(bandeja);
        } catch (Exception e) { bandeja = null; registrar("sin bandeja: " + e.getMessage()); }
    }

    static void notificar(String titulo, String cuerpo) {
        if (bandeja != null) bandeja.displayMessage(titulo, cuerpo, TrayIcon.MessageType.INFO);
        registrar("aviso: " + titulo + " — " + cuerpo);
    }

    // ---------- motor de automatizaciones ----------
    static void eventoMotor(Map<String, Object> v) {
        switch (String.valueOf(v.get("evento"))) {
            case "lista" -> servidor.emitir("automatizaciones", v.get("lista"));
            case "interfaz" -> servidor.emitir("automatizacion:evento", v.get("datos"));
            case "notificar" -> notificar(Json.texto(v.get("titulo")), Json.texto(v.get("cuerpo")));
            case "error" -> registrarError("automatizacion", v.get("id") + ": " + v.get("error"), "");
            default -> { }
        }
    }

    static Object pedidoMotor(Map<String, Object> v) {
        if (!"secreto".equals(v.get("metodo"))) return null;
        return leerSecreto(Json.texto(v.get("auto")), Json.texto(v.get("nombre")));
    }

    static Object llamarMotor(String metodo, List<Object> args, long segundos) throws Exception {
        if (motor == null) throw new Exception("Esta app no tiene automatizaciones");
        return motor.llamar(metodo, args, segundos);
    }

    static void abrirPanel(String auto) {
        Platform.runLater(() -> {
            String url = servidor.direccion() + "_motor/index.html" + (auto != null ? "?id=" + java.net.URLEncoder.encode(auto, StandardCharsets.UTF_8) : "");
            if (panel == null) {
                panel = new Stage();
                vistaPanel = new WebView();
                vistaPanel.getEngine().setUserDataDirectory(datos.resolve("webview-panel").toFile());
                panel.setScene(new Scene(vistaPanel, 1060, 720));
                panel.setTitle("Automatizaciones · " + nombre);
                panel.getIcons().addAll(ventana.getIcons());
            }
            vistaPanel.getEngine().load(url);
            panel.show();
            panel.toFront();
        });
    }

    // ---------- datos privados ----------
    static Path archivoSecretos() { return datos.resolve("secretos.json"); }

    static Map<String, Object> indiceSecretos() {
        try { return Json.objeto(Json.leer(Files.readString(archivoSecretos()))); } catch (Exception e) { return new LinkedHashMap<>(); }
    }

    static String leerSecreto(String auto, String nombreDato) {
        if (prueba != null) {
            Object v = Json.objeto(Json.leer(System.getenv().getOrDefault("DSH_ESCRITORIO_SECRETOS", "{}"))).get(auto + "." + nombreDato);
            if (v != null) return String.valueOf(v);
        }
        Object marca = Json.objeto(indiceSecretos().get(auto)).get(nombreDato);
        return marca == null ? null : Sistema.descifrar(id, auto + "." + nombreDato, String.valueOf(marca));
    }

    static void guardarSecreto(String auto, String nombreDato, String valor) throws Exception {
        Map<String, Object> indice = indiceSecretos();
        Map<String, Object> m = Json.objeto(indice.get(auto));
        if (valor == null || valor.isEmpty()) { m.remove(nombreDato); Sistema.borrar(id, auto + "." + nombreDato); }
        else m.put(nombreDato, Sistema.cifrar(id, auto + "." + nombreDato, valor));
        indice.put(auto, m);
        Files.writeString(archivoSecretos(), Json.escribir(indice));
        Sistema.soloUsuario(archivoSecretos());
    }

    // ---------- actualizaciones con aviso y versión mínima ----------
    static int comparar(String a, String b) {
        String[] x = a.split("[.-]"), y = b.split("[.-]");
        for (int i = 0; i < 3; i++) {
            long p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return Long.compare(p, q);
        }
        return 0;
    }

    static long parse(String s) { try { return Long.parseLong(s.replaceAll("\\D", "")); } catch (Exception e) { return 0; } }

    static Object traerJson(String url, Map<String, String> cabeceras) {
        try {
            HttpRequest.Builder r = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20)).header("Cache-Control", "no-cache");
            cabeceras.forEach(r::header);
            HttpResponse<String> res = red.send(r.build(), HttpResponse.BodyHandlers.ofString());
            return res.statusCode() == 200 ? Json.leer(res.body()) : null;
        } catch (Exception e) { return null; }
    }

    static void fijarActualizacion(Map<String, Object> cambio) {
        synchronized (actualizacion) { actualizacion.putAll(cambio); }
        servidor.emitir("actualizacion", estadoActualizacion());
    }

    static Map<String, Object> estadoActualizacion() {
        synchronized (actualizacion) { Map<String, Object> m = new LinkedHashMap<>(actualizacion); m.put("version_actual", version); return m; }
    }

    static String paginaDescargas() { return Json.texto(config, "paginaVersiones") != null ? Json.texto(config, "paginaVersiones") : Json.texto(config, "sitio"); }

    static synchronized void revisarVersion(boolean manual) {
        if (prueba != null || bloqueada.get()) return;
        List<String> minimas = new ArrayList<>();
        String sitio = Json.texto(config, "sitio");
        if (sitio != null) {
            fijarActualizacion(Map.of("estado", "buscando"));
            Map<String, Object> v = Json.objeto(traerJson(sitio.replaceAll("/+$", "") + "/version.json", Map.of()));
            if (v.isEmpty()) {
                fijarActualizacion(Map.of("estado", "error", "error", "No se pudo consultar la página de descargas"));
                if (manual) notificar(nombre, "No se pudo buscar actualizaciones. Revisa la conexión.");
            } else {
                if (Json.texto(v, "minima") != null) minimas.add(Json.texto(v, "minima"));
                String nueva = Json.texto(v, "version");
                if (nueva != null && comparar(nueva, version) > 0) {
                    fijarActualizacion(Map.of("estado", "disponible", "version", nueva));
                    if (manual || !nueva.equals(avisada)) { notificar(nombre + " " + nueva, "Hay una versión nueva. Ábrela desde la app para descargarla."); avisada = nueva; }
                } else {
                    fijarActualizacion(Map.of("estado", "al-dia"));
                    if (manual) notificar(nombre, "Tienes la última versión (" + version + ").");
                }
            }
        }
        String url = Json.texto(Json.ruta(config, "supabase", "url")), clave = Json.texto(Json.ruta(config, "supabase", "clave"));
        if (url != null && clave != null) {
            List<Object> filas = Json.lista(traerJson(url + "/rest/v1/app_config?clave=eq.version_minima&select=valor", Map.of("apikey", clave, "Authorization", "Bearer " + clave)));
            if (!filas.isEmpty() && Json.texto(Json.objeto(filas.get(0)), "valor") != null) minimas.add(Json.texto(Json.objeto(filas.get(0)), "valor"));
        }
        minimas.sort(App::comparar);
        if (!minimas.isEmpty() && comparar(version, minimas.get(minimas.size() - 1)) < 0) {
            String minima = minimas.get(minimas.size() - 1);
            bloqueada.set(true);
            registrar("versión " + version + " bloqueada: la mínima es " + minima);
            if (motor != null) { motor.detener(); motor = null; }
            fijarActualizacion(Map.of("estado", "obligatoria", "version", minima));
            String q = "?actual=" + enc(version) + "&minima=" + enc(minima) + "&nombre=" + enc(nombre);
            Platform.runLater(() -> vista.getEngine().load(servidor.direccion() + "_motor/bloqueo.html" + q));
            mostrar();
            notificar(nombre + ": actualización obligatoria", "Esta versión (" + version + ") ya no se puede usar. Descarga la " + minima + " o superior.");
        }
    }

    static String enc(String s) { return java.net.URLEncoder.encode(s, StandardCharsets.UTF_8); }

    static void abrirEnNavegador(String url) {
        try {
            if (java.awt.Desktop.isDesktopSupported() && java.awt.Desktop.getDesktop().isSupported(java.awt.Desktop.Action.BROWSE)) java.awt.Desktop.getDesktop().browse(URI.create(url));
            else new ProcessBuilder(Sistema.WIN ? List.of("rundll32", "url.dll,FileProtocolHandler", url) : Sistema.MAC ? List.of("open", url) : List.of("xdg-open", url)).start();
        } catch (Exception e) { registrar("no pude abrir " + url + ": " + e.getMessage()); }
    }

    static void abrirArchivo(File f) {
        try { java.awt.Desktop.getDesktop().open(f); } catch (Exception e) { try { new ProcessBuilder(Sistema.WIN ? List.of("explorer", f.toString()) : Sistema.MAC ? List.of("open", f.toString()) : List.of("xdg-open", f.toString())).start(); } catch (Exception ignored) { } }
    }

    // ---------- archivos del PC ----------
    static <T> T enFx(Supplier<T> f) throws Exception {
        CompletableFuture<T> r = new CompletableFuture<>();
        Platform.runLater(() -> { try { r.complete(f.get()); } catch (Exception e) { r.completeExceptionally(e); } });
        return r.get();
    }

    static FileChooser selector(Map<String, Object> op) {
        FileChooser fc = new FileChooser();
        if (Json.texto(op, "titulo") != null) fc.setTitle(Json.texto(op, "titulo"));
        for (Object f : Json.lista(op.get("filtros"))) {
            Map<String, Object> m = Json.objeto(f);
            List<String> ext = new ArrayList<>();
            for (Object e : Json.lista(m.get("extensions"))) ext.add("*." + e);
            if (!ext.isEmpty()) fc.getExtensionFilters().add(new FileChooser.ExtensionFilter(String.valueOf(m.getOrDefault("name", "Archivos")), ext));
        }
        return fc;
    }

    static boolean esTexto(String n) { return n.toLowerCase().matches(".*\\.(txt|csv|json|md|xml|html?|js|css|tsv|log|ya?ml)$"); }

    // ---------- puente: window.escritorio → aquí ----------
    static Object a(List<Object> args, int i) { return i < args.size() ? args.get(i) : null; }

    static Object atender(String metodo, List<Object> args) {
        try { return atenderConError(metodo, args); } catch (RuntimeException e) { throw e; } catch (Exception e) { throw new RuntimeException(e.getMessage(), e); }
    }

    static Object atenderConError(String metodo, List<Object> args) throws Exception {
        switch (metodo) {
            case "info": return Json.mapa("nombre", nombre, "version", version, "plataforma", Sistema.plataforma(), "equipo", equipo, "tecnologia", "java");
            case "mostrar": mostrar(); return true;
            case "notificar": notificar(Json.texto(a(args, 0)), Json.texto(a(args, 1))); return null;
            case "externo": { String u = Json.texto(a(args, 0)); if (u != null && u.matches("^https?://.*")) abrirEnNavegador(u); return null; }
            case "archivos:abrir": {
                Map<String, Object> op = Json.objeto(a(args, 0));
                List<File> fs = enFx(() -> { FileChooser fc = selector(op); if (Boolean.TRUE.equals(op.get("varios"))) return fc.showOpenMultipleDialog(ventana); File f = fc.showOpenDialog(ventana); return f == null ? null : List.of(f); });
                if (fs == null) return null;
                List<Object> r = new ArrayList<>();
                for (File f : fs) {
                    byte[] b = Files.readAllBytes(f.toPath());
                    Map<String, Object> m = Json.mapa("nombre", f.getName(), "ruta", f.getAbsolutePath(), "tamano", b.length);
                    if (esTexto(f.getName()) || Boolean.TRUE.equals(op.get("comoTexto"))) m.put("texto", new String(b, StandardCharsets.UTF_8)); else m.put("base64", Base64.getEncoder().encodeToString(b));
                    r.add(m);
                }
                return r;
            }
            case "archivos:guardar": {
                Map<String, Object> op = Json.objeto(a(args, 0));
                File f = enFx(() -> { FileChooser fc = selector(op); fc.setInitialFileName(Path.of(String.valueOf(op.getOrDefault("nombre", "archivo.txt"))).getFileName().toString()); File docs = new File(System.getProperty("user.home"), "Documents"); if (docs.isDirectory()) fc.setInitialDirectory(docs); return fc.showSaveDialog(ventana); });
                if (f == null) return null;
                Files.write(f.toPath(), Json.texto(op, "base64") != null ? Base64.getDecoder().decode(Json.texto(op, "base64")) : String.valueOf(op.getOrDefault("contenido", "")).getBytes(StandardCharsets.UTF_8));
                return Json.mapa("ruta", f.getAbsolutePath(), "nombre", f.getName());
            }
            case "archivos:mostrar": { String r = Json.texto(a(args, 0)); if (r != null) { File f = new File(r); abrirArchivo(f.isDirectory() ? f : f.getParentFile()); } return null; }
            case "errores-pendientes": synchronized (errores) { List<Object> l = new ArrayList<>(errores); errores.clear(); return l; }
            case "version:abrir-descargas": case "actualizacion:instalar": { String u = paginaDescargas(); if (u != null) { registrar("abriendo la página de descargas: " + u); abrirEnNavegador(u); } return null; }
            case "inicio-sistema": { if (a(args, 0) instanceof Boolean b) Sistema.inicio(id, nombre, b); return Sistema.inicioActivo(id, nombre); }
            case "actualizacion:estado": return estadoActualizacion();
            case "actualizacion:buscar": new Thread(() -> revisarVersion(true)).start(); return null;
            case "auto:lista": return motor == null ? List.of() : llamarMotor("lista", List.of(), 30);
            case "auto:ejecutar": return llamarMotor("ejecutar", List.of(String.valueOf(a(args, 0)), a(args, 1) == null ? Json.mapa() : a(args, 1)), 30);
            case "auto:activar": return llamarMotor("activar", List.of(String.valueOf(a(args, 0)), Boolean.TRUE.equals(a(args, 1))), 30);
            case "auto:cancelar": return llamarMotor("cancelar", List.of(String.valueOf(a(args, 0))), 30);
            case "auto:historial": { List<Object> l = new ArrayList<>(); l.add(a(args, 0)); l.add(a(args, 1)); return llamarMotor("historial", l, 30); }
            case "auto:sesion": { if (motor == null) return false; List<Object> l = new ArrayList<>(); l.add(a(args, 0)); l.add(a(args, 1)); return llamarMotor("sesion", l, 30); }
            case "auto:panel": abrirPanel(Json.texto(a(args, 0))); return true;
            case "auto:abrir-archivo": { Path f = Path.of(String.valueOf(a(args, 0))).toAbsolutePath().normalize(); if (f.startsWith(datos.resolve("automatizaciones").toAbsolutePath().normalize()) && Files.exists(f)) abrirArchivo(f.toFile()); return null; }
            case "auto:secretos": return new ArrayList<>(Json.objeto(indiceSecretos().get(Json.texto(a(args, 0)))).keySet());
            case "auto:secreto-guardar": guardarSecreto(Json.texto(a(args, 0)), Json.texto(a(args, 1)), Json.texto(a(args, 2))); return atenderConError("auto:secretos", args);
            case "prueba:informe": { Map<String, Object> inf = Json.objeto(a(args, 0)); new Thread(() -> terminarPrueba(inf)).start(); return null; }
            default: throw new Exception("No existe " + metodo);
        }
    }

    // ---------- modo prueba (escritorio_probar): fotos reales de la ventana con JavaFX ----------
    static String foto(WebView v, String archivo) {
        try {
            WritableImage img = enFx(() -> v.snapshot(null, null));
            int w = (int) img.getWidth(), h = (int) img.getHeight();
            BufferedImage b = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
            PixelReader pr = img.getPixelReader();
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) b.setRGB(x, y, pr.getArgb(x, y));
            Path f = prueba.resolve(archivo);
            ImageIO.write(b, "png", f.toFile());
            return f.toString();
        } catch (Exception e) { return null; }
    }

    static void escribirResultado(Map<String, Object> res) {
        try { Files.createDirectories(prueba); Files.writeString(prueba.resolve("resultado.json"), Json.escribir(res)); } catch (Exception ignored) { }
    }

    static void terminarPrueba(Map<String, Object> informe) {
        List<Object> errs = new ArrayList<>(Json.lista(informe.get("errores")));
        List<Object> capturas = new ArrayList<>();
        try { Files.createDirectories(prueba); Thread.sleep(600); } catch (Exception ignored) { }
        String f = foto(vista, "ventana-claro.png");
        if (f != null) capturas.add(f);
        if (Json.texto(informe, "texto") == null || Json.texto(informe, "texto").isBlank()) errs.add("la ventana quedó en blanco");
        Object autos = null;
        if (motor != null) {
            try {
                List<Object> solo = new ArrayList<>();
                for (String s : System.getenv().getOrDefault("DSH_ESCRITORIO_PRUEBA_AUTOS", "").split(",")) if (!s.isEmpty()) solo.add(s);
                List<Object> res = Json.lista(llamarMotor("probar", List.of(solo), 300));
                String primera = null;
                for (Object x : res) {
                    Map<String, Object> m = Json.objeto(x);
                    if (Boolean.FALSE.equals(m.get("ok"))) errs.add("automatización " + m.get("id") + ": " + m.get("error"));
                    if (primera == null && m.containsKey("ok")) primera = Json.texto(m.get("id"));
                }
                autos = res;
                abrirPanel(primera);
                Thread.sleep(3500);
                String fp = foto(vistaPanel, "panel-claro.png");
                if (fp != null) capturas.add(fp);
            } catch (Exception e) { errs.add("motor: " + e.getMessage()); }
        }
        escribirResultado(Json.mapa("nombre", nombre, "version", version, "plataforma", Sistema.plataforma(), "tecnologia", "java", "titulo", informe.get("titulo"), "texto", informe.getOrDefault("texto", ""),
            "puente", informe.getOrDefault("puente", false), "bandeja", bandeja != null, "atajo", null, "errores", errs, "capturas", capturas, "automatizaciones", autos));
        salir(errs.isEmpty() ? 0 : 1);
    }
}
