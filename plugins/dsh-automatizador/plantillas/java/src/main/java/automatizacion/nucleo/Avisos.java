package automatizacion.nucleo;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/** Envía avisos por webhook (Discord, Slack, Google Chat, n8n…) y/o Telegram. Nunca hace fallar la automatización. */
public final class Avisos {
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    private Avisos() {}

    public static void avisar(Config cfg, Registro log, String titulo, String texto) {
        String mensaje = (titulo + "\n" + texto).strip();
        String url = cfg.obtener("AVISO_WEBHOOK_URL");
        if (url != null && !url.isBlank()) {
            Map<String, Object> cuerpo = new LinkedHashMap<>();
            cuerpo.put("text", mensaje);
            cuerpo.put("content", mensaje.length() > 1900 ? mensaje.substring(0, 1900) : mensaje);
            cuerpo.put("titulo", titulo);
            cuerpo.put("detalle", texto);
            enviar(log, "webhook", url, Json.escribir(cuerpo), "application/json");
        }
        String token = cfg.obtener("TELEGRAM_BOT_TOKEN"), chat = cfg.obtener("TELEGRAM_CHAT_ID");
        if (token != null && chat != null && !token.isBlank() && !chat.isBlank()) {
            String form = "chat_id=" + URLEncoder.encode(chat, StandardCharsets.UTF_8) + "&text=" + URLEncoder.encode(mensaje.length() > 4000 ? mensaje.substring(0, 4000) : mensaje, StandardCharsets.UTF_8);
            enviar(log, "Telegram", "https://api.telegram.org/bot" + token + "/sendMessage", form, "application/x-www-form-urlencoded");
        }
    }

    private static void enviar(Registro log, String canal, String url, String cuerpo, String tipo) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(15))
                    .header("Content-Type", tipo).POST(HttpRequest.BodyPublishers.ofString(cuerpo, StandardCharsets.UTF_8)).build();
            HttpResponse<Void> r = HTTP.send(req, HttpResponse.BodyHandlers.discarding());
            if (r.statusCode() >= 300) log.aviso("el aviso por " + canal + " respondió " + r.statusCode(), Map.of());
        } catch (Exception e) {
            log.aviso("no se pudo enviar el aviso por " + canal, Map.of("error", String.valueOf(e.getMessage())));
        }
    }
}
