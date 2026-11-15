# Motor de dsh-transcriptor: proceso que queda abierto con el modelo Whisper cargado.
# Recibe órdenes por la entrada estándar (una línea JSON por orden) y responde igual.
#   {"id": "1", "op": "transcribir", "archivo": "...", "idioma": "es", "modelo": "large-v3-turbo", "vocabulario": "Suzuka, AULAPP"}
#   {"id": "2", "op": "cargar", "modelo": "large-v3-turbo"}      (descarga y carga el modelo)
# Respuestas: {"tipo": "listo"} al arrancar; por orden: "progreso", y al final "fin" o "error".
# Todo corre en este computador; el audio no sale de aquí.
import json
import math
import os
import sys
import time

FALSO = os.environ.get("DSH_TRANSCRIPTOR_FALSO") == "1"  # solo para pruebas automáticas
DISPOSITIVO = os.environ.get("DSH_TRANSCRIPTOR_DISPOSITIVO", "auto")
modelos = {}


def decir(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def cargar(nombre):
    if nombre in modelos:
        return modelos[nombre]
    from faster_whisper import WhisperModel

    intentos = [("cuda", "float16"), ("cpu", "int8")] if DISPOSITIVO in ("auto", "cuda") else [("cpu", "int8")]
    ultimo = None
    for dispositivo, tipo in intentos:
        try:
            m = WhisperModel(nombre, device=dispositivo, compute_type=tipo)
            modelos[nombre] = (m, dispositivo)
            return modelos[nombre]
        except Exception as e:  # sin tarjeta gráfica compatible: se usa el procesador
            ultimo = e
    raise ultimo


def decodificar(ruta):
    """Audio o video de cualquier formato → onda a 16 kHz en mono. Con respaldo propio por si
    la versión instalada de PyAV no es compatible con la de faster-whisper."""
    try:
        from faster_whisper.audio import decode_audio
        return decode_audio(ruta, sampling_rate=16000)
    except TypeError:
        import av
        import numpy as np

        trozos = []
        with av.open(ruta, mode="r") as cont:
            conv = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
            for cuadro in cont.decode(audio=0):
                for c in conv.resample(cuadro):
                    trozos.append(c.to_ndarray().reshape(-1))
            for c in conv.resample(None):
                trozos.append(c.to_ndarray().reshape(-1))
        if not trozos:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(trozos).astype(np.float32) / 32768.0


def autoprueba():
    """Comprueba que el motor sabe leer audio (sin necesitar el modelo)."""
    import math as m
    import struct
    import tempfile
    import wave

    ruta = os.path.join(tempfile.gettempdir(), "dsh-transcriptor-prueba.wav")
    with wave.open(ruta, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * m.sin(i / 6.0))) for i in range(8000)))
    onda = decodificar(ruta)
    os.remove(ruta)
    if abs(len(onda) / 16000 - 1.0) > 0.1:
        raise RuntimeError("la lectura de audio devolvió una duración inesperada")


def transcribir(orden):
    ident = orden["id"]
    archivo = orden["archivo"]
    if not os.path.isfile(archivo):
        raise FileNotFoundError("no existe el archivo: " + archivo)
    if FALSO:
        partes = [(0.0, 2.5, "Hola, esta es una prueba del transcriptor.", -0.15, 0.01, 1.2),
                  (2.5, 6.0, "El aprendiz llega a la sede de Girardot.", -0.2, 0.02, 1.3),
                  (8.4, 11.0, "Algo que no se entendió bien.", -1.2, 0.3, 1.1)]
        segs = []
        for n, (i, f, t, lp, ns, cr) in enumerate(partes):
            time.sleep(float(os.environ.get("DSH_TRANSCRIPTOR_FALSO_PAUSA", "0.05")))
            segs.append({"i": i, "f": f, "t": t, "logprob": lp, "silencio": ns, "compresion": cr})
            decir({"id": ident, "tipo": "progreso", "pct": round((n + 1) / len(partes) * 100)})
        decir({"id": ident, "tipo": "fin", "idioma": orden.get("idioma") or "es", "duracion": 11.0, "segmentos": segs,
               "modelo": orden.get("modelo"), "dispositivo": "falso", "vocabulario": orden.get("vocabulario") or ""})
        return

    modelo, dispositivo = cargar(orden.get("modelo") or "large-v3-turbo")
    vocabulario = (orden.get("vocabulario") or "").strip() or None
    segmentos, info = modelo.transcribe(
        decodificar(archivo),
        language=orden.get("idioma") or None,  # None = detectar
        beam_size=int(orden.get("beam") or 5),
        vad_filter=True,  # ignora silencios y ruido: menos texto inventado
        vad_parameters={"min_silence_duration_ms": 500},
        hotwords=vocabulario,  # nombres propios y términos del proyecto
        condition_on_previous_text=False,  # evita que un error se arrastre a lo que sigue
        temperature=[0.0, 0.2, 0.4],
    )
    duracion = float(info.duration or 0)
    out = []
    ultimo = -1
    for s in segmentos:
        texto = (s.text or "").strip()
        if texto:
            out.append({"i": round(s.start, 2), "f": round(s.end, 2), "t": texto,
                        "logprob": round(s.avg_logprob, 3) if not math.isnan(s.avg_logprob) else -9,
                        "silencio": round(s.no_speech_prob, 3), "compresion": round(s.compression_ratio, 2)})
        pct = int(min(99, s.end / duracion * 100)) if duracion else 0
        if pct > ultimo:
            ultimo = pct
            decir({"id": ident, "tipo": "progreso", "pct": pct})
    decir({"id": ident, "tipo": "fin", "idioma": info.language, "duracion": round(duracion, 1), "segmentos": out,
           "modelo": orden.get("modelo"), "dispositivo": dispositivo})


def main():
    version = "falso"
    if not FALSO:
        try:
            import faster_whisper
            version = "faster-whisper " + faster_whisper.__version__
        except Exception as e:
            decir({"tipo": "sin-motor", "mensaje": str(e)})
            return 2
    decir({"tipo": "listo", "motor": version})
    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
        try:
            orden = json.loads(linea)
        except Exception:
            continue
        if orden.get("op") == "salir":
            break
        try:
            if orden.get("op") == "cargar":
                if not FALSO:
                    cargar(orden.get("modelo") or "large-v3-turbo")
                decir({"id": orden.get("id"), "tipo": "fin", "segmentos": [], "duracion": 0})
            elif orden.get("op") == "probar":
                if not FALSO:
                    autoprueba()
                decir({"id": orden.get("id"), "tipo": "fin", "segmentos": [], "duracion": 0})
            elif orden.get("op") == "transcribir":
                transcribir(orden)
            else:
                decir({"id": orden.get("id"), "tipo": "error", "mensaje": "orden desconocida"})
        except Exception as e:
            decir({"id": orden.get("id"), "tipo": "error", "mensaje": type(e).__name__ + ": " + str(e)[:600]})
    return 0


if __name__ == "__main__":
    sys.exit(main())
