import json
import os
import random
import sys
import time
import traceback
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from .avisos import avisar
from .config import cargar_env, faltantes, valores_secretos
from .estado import Estado
from .registro import Registro

RAIZ = Path(__file__).resolve().parent.parent


class Contexto:
    def __init__(self, nombre, prueba, forzar, log, estado):
        self.nombre, self.prueba, self.forzar, self.log, self._estado = nombre, prueba, forzar, log, estado
        self.resultado = {}
        self.pasos = []

    def config(self, clave, defecto=None):
        v = os.environ.get(clave, defecto)
        if v is None:
            raise KeyError(f"falta la variable {clave} en .env")
        return v

    @contextmanager
    def paso(self, nombre):
        anterior, self.log.paso = self.log.paso, nombre
        t0 = time.monotonic()
        self.log.info("inicia")
        try:
            yield
            self.pasos.append({"paso": nombre, "ok": True, "segundos": round(time.monotonic() - t0, 2)})
            self.log.info("termina", segundos=round(time.monotonic() - t0, 2))
        except Exception as e:
            self.pasos.append({"paso": nombre, "ok": False, "segundos": round(time.monotonic() - t0, 2), "error": f"{type(e).__name__}: {e}"})
            self.log.error("falló", error=f"{type(e).__name__}: {e}")
            raise
        finally:
            self.log.paso = anterior

    def reintentar(self, funcion, intentos=4, espera=2.0, maximo=60.0, errores=(Exception,)):
        """Llama funcion(); si falla, reintenta con espera creciente (2s, 4s, 8s… + azar)."""
        for n in range(1, intentos + 1):
            try:
                return funcion()
            except errores as e:
                if n == intentos:
                    raise
                pausa = min(maximo, espera * (2 ** (n - 1))) + random.uniform(0, 0.5)
                self.log.aviso("reintento", intento=n, de=intentos, espera_s=round(pausa, 1), error=f"{type(e).__name__}: {e}")
                time.sleep(pausa)

    def ya_hecho(self, clave):
        return False if self.forzar else self._estado.ya_hecho(clave)

    def marcar(self, clave, detalle=""):
        if self.prueba:
            return
        self._estado.marcar(clave, detalle)


def _bloquear(archivo: Path):
    """Evita dos ejecuciones simultáneas (por ejemplo, si el cron dispara antes de que termine la anterior)."""
    archivo.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(archivo, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        if time.time() - archivo.stat().st_mtime > 6 * 3600:  # candado viejo de una ejecución que murió
            archivo.unlink(missing_ok=True)
            return _bloquear(archivo)
        return False


def ejecutar_automatizacion(nombre, funcion, prueba=False, forzar=False, requeridas=()):
    cargar_env(RAIZ)
    prueba = prueba or os.environ.get("MODO_PRUEBA", "").lower() in ("1", "true", "si", "sí")
    ejecucion = uuid.uuid4().hex[:8]
    log = Registro(RAIZ / "logs", valores_secretos(), ejecucion)
    candado = RAIZ / "datos" / "ejecucion.lock"
    if not _bloquear(candado):
        log.aviso("ya hay una ejecución en curso; esta se omite")
        return 0
    inicio = datetime.now()
    estado = Estado(RAIZ / "datos" / "estado.db")
    ctx = Contexto(nombre, prueba, forzar, log, estado)
    registro = {"ejecucion": ejecucion, "automatizacion": nombre, "inicio": inicio.isoformat(timespec="seconds"), "modo": "prueba" if prueba else "real"}
    codigo = 0
    try:
        falta = faltantes(requeridas)
        if falta:
            raise RuntimeError(f"faltan variables en .env: {', '.join(falta)} (ver .env.example)")
        log.info("inicia la automatización", modo=registro["modo"])
        funcion(ctx)
        registro["estado"] = "ok"
        log.info("terminó bien", **ctx.resultado)
    except Exception as e:  # noqa: BLE001
        codigo = 1
        registro["estado"] = "error"
        registro["error"] = f"{type(e).__name__}: {e}"
        log.error("la automatización falló", error=registro["error"], traza=traceback.format_exc(limit=6))
    finally:
        registro["fin"] = datetime.now().isoformat(timespec="seconds")
        registro["segundos"] = round((datetime.now() - inicio).total_seconds(), 1)
        registro["pasos"] = ctx.pasos
        registro["resultado"] = ctx.resultado
        (RAIZ / "logs").mkdir(exist_ok=True)
        with (RAIZ / "logs" / "ejecuciones.jsonl").open("a", encoding="utf-8") as f:
            f.write(log.limpio(json.dumps(registro, ensure_ascii=False, default=str)) + "\n")  # sin secretos
        estado.cerrar()
        candado.unlink(missing_ok=True)
    falla = registro["estado"] == "error"
    if (falla or os.environ.get("AVISAR_EXITO", "").lower() in ("1", "true", "si", "sí")) and not prueba:
        titulo = f"{'❌' if falla else '✅'} {nombre} ({registro['segundos']} s)"
        avisar(titulo, log.limpio(registro.get("error") or json.dumps(ctx.resultado, ensure_ascii=False, default=str)), log)
    return codigo
