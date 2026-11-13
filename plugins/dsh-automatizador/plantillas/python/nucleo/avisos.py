import json
import os
import urllib.parse
import urllib.request


def _post(url, cuerpo, tipo="application/json"):
    datos = cuerpo if isinstance(cuerpo, bytes) else json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=datos, headers={"Content-Type": tipo}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status


def avisar(titulo: str, texto: str, log=None) -> None:
    """Envía el aviso por los canales configurados en .env. Nunca hace fallar la automatización."""
    mensaje = f"{titulo}\n{texto}".strip()
    url = os.environ.get("AVISO_WEBHOOK_URL")
    if url:
        try:
            # "content" lo entiende Discord, "text" Slack/Google Chat/n8n.
            _post(url, {"text": mensaje, "content": mensaje[:1900], "titulo": titulo, "detalle": texto})
        except Exception as e:  # noqa: BLE001
            if log: log.aviso("no se pudo enviar el aviso por webhook", error=str(e))
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if token and chat:
        try:
            _post(f"https://api.telegram.org/bot{token}/sendMessage", urllib.parse.urlencode({"chat_id": chat, "text": mensaje[:4000]}).encode(), "application/x-www-form-urlencoded")
        except Exception as e:  # noqa: BLE001
            if log: log.aviso("no se pudo enviar el aviso por Telegram", error=str(e))
