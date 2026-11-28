package escritorio;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Lo que depende del sistema operativo: carpeta de datos, datos privados cifrados y arranque con el sistema. */
final class Sistema {
    static final String OS = System.getProperty("os.name").toLowerCase();
    static final boolean WIN = OS.contains("win"), MAC = OS.contains("mac");

    static String plataforma() { return WIN ? "win32" : MAC ? "darwin" : "linux"; }

    static Path carpetaDatos(String nombre) {
        String casa = System.getProperty("user.home");
        if (WIN) return Path.of(System.getenv().getOrDefault("APPDATA", casa), nombre);
        if (MAC) return Path.of(casa, "Library", "Application Support", nombre);
        String xdg = System.getenv("XDG_CONFIG_HOME");
        return Path.of(xdg != null && !xdg.isEmpty() ? xdg : casa + "/.config", nombre);
    }

    static String equipo() {
        String e = System.getenv(WIN ? "COMPUTERNAME" : "HOSTNAME");
        if (e != null && !e.isEmpty()) return e;
        try { return java.net.InetAddress.getLocalHost().getHostName(); } catch (Exception x) { return "equipo"; }
    }

    private static String correr(List<String> cmd, Map<String, String> env, String entrada) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(cmd).redirectErrorStream(true);
        if (env != null) pb.environment().putAll(env);
        Process p = pb.start();
        if (entrada != null) { p.getOutputStream().write(entrada.getBytes(StandardCharsets.UTF_8)); }
        p.getOutputStream().close();
        String salida = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
        if (!p.waitFor(20, TimeUnit.SECONDS) || p.exitValue() != 0) throw new Exception(salida);
        return salida;
    }

    // ---------- datos privados: Windows DPAPI, Llavero de Mac, llavero de Linux (secret-tool) ----------
    static String cifrar(String servicio, String cuenta, String valor) throws Exception {
        if (WIN) {
            String ps = "Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($env:DSH_VALOR), $null, 'CurrentUser'))";
            return "dpapi:" + correr(List.of("powershell", "-NoProfile", "-NonInteractive", "-Command", ps), Map.of("DSH_VALOR", valor), null);
        }
        if (MAC) { correr(List.of("security", "add-generic-password", "-U", "-s", servicio, "-a", cuenta, "-w", valor), null, null); return "llavero"; }
        try { correr(List.of("secret-tool", "store", "--label=" + servicio, "service", servicio, "account", cuenta), null, valor); return "llavero"; }
        catch (Exception e) { return "b64:" + Base64.getEncoder().encodeToString(valor.getBytes(StandardCharsets.UTF_8)); } // Linux sin llavero
    }

    static String descifrar(String servicio, String cuenta, String marca) {
        try {
            if (marca.startsWith("b64:")) return new String(Base64.getDecoder().decode(marca.substring(4)), StandardCharsets.UTF_8);
            if (marca.startsWith("dpapi:")) {
                String ps = "Add-Type -AssemblyName System.Security; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:DSH_VALOR), $null, 'CurrentUser'))";
                return correr(List.of("powershell", "-NoProfile", "-NonInteractive", "-Command", ps), Map.of("DSH_VALOR", marca.substring(6)), null);
            }
            if (MAC) return correr(List.of("security", "find-generic-password", "-s", servicio, "-a", cuenta, "-w"), null, null);
            return correr(List.of("secret-tool", "lookup", "service", servicio, "account", cuenta), null, null);
        } catch (Exception e) { return null; }
    }

    static void borrar(String servicio, String cuenta) {
        try {
            if (MAC) correr(List.of("security", "delete-generic-password", "-s", servicio, "-a", cuenta), null, null);
            else if (!WIN) correr(List.of("secret-tool", "clear", "service", servicio, "account", cuenta), null, null);
        } catch (Exception ignored) { }
    }

    static void soloUsuario(Path f) {
        try { Files.setPosixFilePermissions(f, PosixFilePermissions.fromString("rw-------")); } catch (Exception ignored) { }
    }

    // ---------- arrancar con el sistema ----------
    static String ejecutable() { return System.getProperty("jpackage.app-path"); }

    static boolean inicioActivo(String id, String nombre) {
        try {
            if (WIN) return correr(List.of("reg", "query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", nombre), null, null).contains(nombre);
            if (MAC) return Files.exists(Path.of(System.getProperty("user.home"), "Library", "LaunchAgents", id + ".plist"));
            return Files.exists(Path.of(System.getProperty("user.home"), ".config", "autostart", id + ".desktop"));
        } catch (Exception e) { return false; }
    }

    static void inicio(String id, String nombre, boolean activar) throws Exception {
        String exe = ejecutable();
        if (activar && exe == null) throw new Exception("Solo funciona en la app instalada");
        if (WIN) {
            List<String> c = new ArrayList<>(activar ? List.of("reg", "add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", nombre, "/t", "REG_SZ", "/d", "\"" + exe + "\"", "/f") : List.of("reg", "delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", nombre, "/f"));
            try { correr(c, null, null); } catch (Exception e) { if (activar) throw e; }
            return;
        }
        Path f = MAC ? Path.of(System.getProperty("user.home"), "Library", "LaunchAgents", id + ".plist") : Path.of(System.getProperty("user.home"), ".config", "autostart", id + ".desktop");
        if (!activar) { Files.deleteIfExists(f); return; }
        Files.createDirectories(f.getParent());
        String exeMac = exe != null && exe.contains(".app/") ? exe : exe;
        Files.writeString(f, MAC
            ? "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>Label</key><string>" + id + "</string><key>ProgramArguments</key><array><string>" + exeMac + "</string></array><key>RunAtLoad</key><true/></dict></plist>\n"
            : "[Desktop Entry]\nType=Application\nName=" + nombre + "\nExec=\"" + exe + "\"\nX-GNOME-Autostart-enabled=true\n");
    }
}
