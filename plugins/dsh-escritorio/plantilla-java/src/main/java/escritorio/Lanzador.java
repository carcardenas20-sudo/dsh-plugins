package escritorio;

/** Punto de entrada: JavaFX en el classpath necesita que el main no herede de Application. */
public final class Lanzador {
    public static void main(String[] args) {
        System.setProperty("prism.lcdtext", "false");
        App.main(args);
    }
}
