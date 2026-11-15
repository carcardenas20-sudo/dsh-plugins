# dsh-transcriptor

Voz a texto dentro de DeepSeek Harness, **todo en tu computador**: el audio no se envía a ningún servicio.

## Qué hace

- **Grabaciones a texto.** Reuniones, notas de voz, audios de WhatsApp (`.opus`), videos: quedan en `transcripciones/<nombre>.md` con marcas de tiempo.
- **Dictado.** Una página local con un botón para hablar. Lo que dictes le llega a DeepSeek cuando escribes `dictado` en Harness. En la misma página puedes arrastrar grabaciones.
- **No inventa en silencio.** Lo que no se oyó bien queda marcado con `⚠[…]` y con su minuto, para que lo escuches en vez de confiar a ciegas.
- **Conoce tu proyecto.** Le pasa al motor los nombres propios y siglas de la memoria y del mapa del proyecto, más los que agregues, para que no los escriba mal.

## Motor

Whisper (`faster-whisper`), modelo `large-v3-turbo`. Se instala una sola vez en `~/.dsh-transcriptor` (no toca Harness ni tus proyectos):

- Necesita **Python 3.9 o más nuevo** e internet para la instalación.
- Descarga el modelo, de alrededor de 1,6 GB.
- Sin tarjeta gráfica funciona con el procesador; una grabación larga puede tardar tanto como dura el audio, o más. Sigue en segundo plano.

Pídele a DeepSeek: *"prepara el transcriptor"*.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `transcriptor_preparar` | Instala el motor y descarga el modelo. |
| `transcribir` | Transcribe un audio o video del proyecto o de cualquier carpeta. |
| `transcripcion_estado` | Avance de las transcripciones en curso. |
| `transcriptor_vocabulario` | Palabras que debe reconocer (nombres, siglas). |
| `dictado_abrir` | Enlace de la página de dictado. |

## Lo que no hace

- No es perfecto: con ruido, varias personas hablando a la vez o audio lejano se equivoca. Por eso marca lo dudoso.
- No distingue quién habla (no separa por persona).

## Instalar

Harness Desktop: **solo desde la app**, en Plugins → Add plugin:

```
https://raw.githubusercontent.com/carcardenas20-sudo/dsh-plugins/main/paquetes/dsh-transcriptor-0.1.0.tgz
```

## Configuración opcional

| Opción | Por defecto | Para qué |
|---|---|---|
| `modelo` | `large-v3-turbo` | `large-v3` es algo más preciso y bastante más lento; `small` es rápido y menos preciso. |
| `modeloDictado` | el mismo | Pon `small` si el dictado te parece lento. |
| `idioma` | `es` | Idioma por defecto (`auto` para detectar). |
| `dispositivo` | `auto` | `cpu` o `cuda` (tarjeta gráfica NVIDIA). |
| `puerto` | `47822` | Puerto de la página de dictado. |
