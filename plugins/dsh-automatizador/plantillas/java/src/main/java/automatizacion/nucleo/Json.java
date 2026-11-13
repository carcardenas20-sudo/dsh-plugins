package automatizacion.nucleo;

import java.util.Collection;
import java.util.Map;

/** JSON mínimo para escribir registros (sin dependencias). */
public final class Json {
    private Json() {}

    public static String escribir(Object v) {
        StringBuilder sb = new StringBuilder();
        escribir(v, sb);
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static void escribir(Object v, StringBuilder sb) {
        if (v == null) sb.append("null");
        else if (v instanceof Number || v instanceof Boolean) sb.append(v);
        else if (v instanceof Map<?, ?> m) {
            sb.append('{');
            boolean primero = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!primero) sb.append(',');
                primero = false;
                texto(String.valueOf(e.getKey()), sb);
                sb.append(':');
                escribir(e.getValue(), sb);
            }
            sb.append('}');
        } else if (v instanceof Collection<?> c) {
            sb.append('[');
            boolean primero = true;
            for (Object x : c) {
                if (!primero) sb.append(',');
                primero = false;
                escribir(x, sb);
            }
            sb.append(']');
        } else texto(String.valueOf(v), sb);
    }

    private static void texto(String s, StringBuilder sb) {
        sb.append('"');
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> { if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c); }
            }
        }
        sb.append('"');
    }
}
