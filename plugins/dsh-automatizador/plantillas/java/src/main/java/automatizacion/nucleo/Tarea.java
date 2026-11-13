package automatizacion.nucleo;

import java.util.List;

public final class Tarea {
    private Tarea() {}

    /** Contrato de la lógica de negocio. */
    public interface Logica {
        default List<String> variablesRequeridas() { return List.of(); }
        void ejecutar(Contexto ctx) throws Exception;
    }

    /** Algo que devuelve un valor y puede fallar. */
    @FunctionalInterface
    public interface Accion<T> { T llamar() throws Exception; }

    /** Algo que no devuelve nada y puede fallar. */
    @FunctionalInterface
    public interface Bloque { void correr() throws Exception; }
}
