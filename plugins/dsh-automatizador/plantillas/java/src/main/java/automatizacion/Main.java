package automatizacion;

import automatizacion.nucleo.Ejecutor;

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

/**
 * {{NOMBRE}} — {{DESCRIPCION}}
 *
 * Uso:
 *   java -jar {{NOMBRE}}.jar --prueba   hace todo pero NO envía ni modifica nada externo
 *   java -jar {{NOMBRE}}.jar            ejecución real
 *   java -jar {{NOMBRE}}.jar --forzar   ignora el registro de "ya hecho"
 */
public final class Main {
    public static void main(String[] args) {
        // Tildes y emojis bien en la consola del servidor y de Windows.
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8));
        System.setErr(new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8));
        boolean prueba = false, forzar = false;
        for (String a : args) {
            if (a.equals("--prueba")) prueba = true;
            else if (a.equals("--forzar")) forzar = true;
            else if (a.equals("--help") || a.equals("-h")) {
                System.out.println("Uso: [--prueba] [--forzar]");
                return;
            }
        }
        System.exit(Ejecutor.ejecutar("{{NOMBRE}}", new Tarea(), prueba, forzar));
    }
}
