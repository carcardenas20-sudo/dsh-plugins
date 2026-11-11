# dsh-ojos

DeepSeek-V4-Pro no ve imágenes; DeepSeek-V4.1-Flash sí. Con este plugin puedes pegar capturas, errores o diseños mientras trabajas con Pro:

1. Antes de cada paso, si el mensaje trae imágenes y el modelo elegido no las ve, el plugin se las muestra a Flash.
2. Flash devuelve una descripción fiel: todo el texto transcrito tal cual (errores, rutas, números), la interfaz, tablas y diagramas.
3. Pro recibe esa descripción en lugar de la imagen y sigue trabajando.

Si el modelo elegido ve imágenes (Flash), el plugin no hace nada. También cubre imágenes viejas del historial, por ejemplo si mandaste una captura con Flash y después cambiaste a Pro.

Cada imagen se describe una sola vez por sesión de dsh: es una llamada corta a Flash, el modelo barato.

## Instalar

```
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-ojos"
```

En Harness Desktop, instálalo desde Settings → Plugins con el mismo enlace.

## Paso obligatorio: dejar que la interfaz acepte imágenes con Pro

dsh bloquea el botón de adjuntar cuando el modelo no declara imágenes ("The current model does not support images"). Hay que decirle que Pro sí las acepta; el plugin se encarga de que nunca le lleguen.

1. Settings → Models → DeepSeek → Edit → Customized settings → Add model. Aplica sin cambiar nada (esto escribe la lista de modelos en la configuración).
2. Abre el archivo de configuración (Settings → Open configuration file, o `cordis.patch.yml` de tu perfil).
3. En el bloque `llm-deepseek`, busca `deepseek-v4-pro` y deja sus `inputModalities` así:

```yaml
      - id: deepseek-v4-pro
        name: DeepSeek-V4-Pro
        contextWindow: 1048576
        inputModalities:
          - text
          - image
```

4. Guarda y reinicia dsh.

No hagas esto sin el plugin instalado: Pro recibiría las imágenes y la API podría rechazar la petición.

## Configuración (opcional)

| Clave | Por defecto | Qué hace |
| --- | --- | --- |
| `vision.model` | `deepseek-flash` | Modelo que mira las imágenes. |
| `vision.provider` | el del modelo elegido | Proveedor del modelo de visión. |
| `modelosSinVision` | `["deepseek-v4-pro"]` | Modelos que no ven imágenes aunque estén marcados con imagen. |
| `modelosConVision` | `[]` | Modelos que sí ven imágenes aunque dsh no lo diga. |
| `siempre` | `false` | Describir las imágenes aunque el modelo elegido las vea. |
| `maxImagenes` | `8` | Máximo de imágenes por mensaje. |
| `timeoutSegundos` | `120` | Tiempo máximo por imagen. |
| `historial` | `true` | Cambiar también imágenes viejas del historial. |

Si Flash falla, Pro recibe un aviso en lugar de la imagen y te dirá que cambies a Flash.
