package automatizacion.nucleo;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.Set;

/** Recuerda lo ya procesado (archivo de texto, una clave por línea) para no repetir trabajo. */
public final class Estado {
    private final Path archivo;
    private final Set<String> hechos = new HashSet<>();

    public Estado(Path archivo) {
        this.archivo = archivo;
        try {
            Files.createDirectories(archivo.getParent());
            if (Files.exists(archivo)) {
                for (String l : Files.readAllLines(archivo, StandardCharsets.UTF_8)) {
                    int tab = l.indexOf('\t');
                    if (tab > 0) hechos.add(l.substring(0, tab));
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("no pude leer el estado: " + e.getMessage(), e);
        }
    }

    public boolean yaHecho(String clave) { return hechos.contains(clave); }

    public synchronized void marcar(String clave, String detalle) {
        if (clave.contains("\t") || clave.contains("\n")) throw new IllegalArgumentException("la clave no puede tener tabulaciones ni saltos de línea");
        String linea = clave + "\t" + LocalDateTime.now().truncatedTo(ChronoUnit.SECONDS) + "\t" + (detalle == null ? "" : detalle.replace('\n', ' ').replace('\t', ' ')) + "\n";
        try {
            Files.writeString(archivo, linea, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            hechos.add(clave);
        } catch (IOException e) {
            throw new IllegalStateException("no pude guardar el estado: " + e.getMessage(), e);
        }
    }
}
