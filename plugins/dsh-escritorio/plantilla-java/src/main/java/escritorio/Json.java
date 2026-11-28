package escritorio;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** JSON mínimo sin dependencias: objetos → Map, listas → List, números → Double. */
public final class Json {
    private final String s;
    private int i;

    private Json(String s) { this.s = s; }

    public static Object leer(String texto) {
        if (texto == null || texto.isBlank()) return null;
        Json j = new Json(texto);
        j.espacios();
        Object v = j.valor();
        j.espacios();
        if (j.i < j.s.length()) throw new IllegalArgumentException("JSON con texto de sobra en " + j.i);
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> objeto(Object o) { return o instanceof Map ? (Map<String, Object>) o : new LinkedHashMap<>(); }

    @SuppressWarnings("unchecked")
    public static List<Object> lista(Object o) { return o instanceof List ? (List<Object>) o : new ArrayList<>(); }

    public static String texto(Object o) { return o == null ? null : o instanceof String t ? t : String.valueOf(o); }

    public static String texto(Map<String, Object> m, String k) { Object v = m.get(k); return v instanceof String t && !t.isEmpty() ? t : null; }

    public static Object ruta(Object o, String... claves) {
        for (String k : claves) { if (!(o instanceof Map)) return null; o = objeto(o).get(k); }
        return o;
    }

    private void espacios() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

    private Object valor() {
        char c = s.charAt(i);
        if (c == '{') {
            i++;
            Map<String, Object> m = new LinkedHashMap<>();
            espacios();
            if (s.charAt(i) == '}') { i++; return m; }
            while (true) {
                espacios();
                String k = cadena();
                espacios();
                if (s.charAt(i++) != ':') throw new IllegalArgumentException("se esperaba :");
                espacios();
                m.put(k, valor());
                espacios();
                char d = s.charAt(i++);
                if (d == '}') return m;
                if (d != ',') throw new IllegalArgumentException("se esperaba , o }");
            }
        }
        if (c == '[') {
            i++;
            List<Object> l = new ArrayList<>();
            espacios();
            if (s.charAt(i) == ']') { i++; return l; }
            while (true) {
                espacios();
                l.add(valor());
                espacios();
                char d = s.charAt(i++);
                if (d == ']') return l;
                if (d != ',') throw new IllegalArgumentException("se esperaba , o ]");
            }
        }
        if (c == '"') return cadena();
        if (s.startsWith("true", i)) { i += 4; return true; }
        if (s.startsWith("false", i)) { i += 5; return false; }
        if (s.startsWith("null", i)) { i += 4; return null; }
        int ini = i;
        while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
        if (ini == i) throw new IllegalArgumentException("JSON inválido en " + i);
        return Double.parseDouble(s.substring(ini, i));
    }

    private String cadena() {
        if (s.charAt(i++) != '"') throw new IllegalArgumentException("se esperaba \"");
        StringBuilder b = new StringBuilder();
        while (true) {
            char c = s.charAt(i++);
            if (c == '"') return b.toString();
            if (c != '\\') { b.append(c); continue; }
            char e = s.charAt(i++);
            switch (e) {
                case 'n' -> b.append('\n');
                case 't' -> b.append('\t');
                case 'r' -> b.append('\r');
                case 'b' -> b.append('\b');
                case 'f' -> b.append('\f');
                case 'u' -> { b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; }
                default -> b.append(e);
            }
        }
    }

    public static String escribir(Object o) {
        StringBuilder b = new StringBuilder();
        escribir(o, b);
        return b.toString();
    }

    private static void escribir(Object o, StringBuilder b) {
        if (o == null) b.append("null");
        else if (o instanceof String t) comillas(t, b);
        else if (o instanceof Boolean) b.append(o);
        else if (o instanceof Number n) {
            double d = n.doubleValue();
            if (d == Math.rint(d) && Math.abs(d) < 1e15) b.append((long) d); else b.append(d);
        } else if (o instanceof Map<?, ?> m) {
            b.append('{');
            boolean primero = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!primero) b.append(',');
                primero = false;
                comillas(String.valueOf(e.getKey()), b);
                b.append(':');
                escribir(e.getValue(), b);
            }
            b.append('}');
        } else if (o instanceof Iterable<?> l) {
            b.append('[');
            boolean primero = true;
            for (Object x : l) { if (!primero) b.append(','); primero = false; escribir(x, b); }
            b.append(']');
        } else comillas(String.valueOf(o), b);
    }

    private static void comillas(String t, StringBuilder b) {
        b.append('"');
        for (char c : t.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                case '<' -> b.append("\\u003c"); // seguro dentro de <script>
                default -> { if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c); }
            }
        }
        b.append('"');
    }

    public static Map<String, Object> mapa(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int k = 0; k + 1 < kv.length; k += 2) m.put(String.valueOf(kv[k]), kv[k + 1]);
        return m;
    }
}
