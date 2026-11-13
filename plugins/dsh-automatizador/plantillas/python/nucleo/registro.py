import json
import sys
from datetime import datetime
from pathlib import Path


class Registro:
    """Log en consola (legible) y en logs/AAAA-MM-DD.jsonl (para analizar). Oculta secretos."""

    def __init__(self, carpeta: Path, secretos, ejecucion: str):
        carpeta.mkdir(parents=True, exist_ok=True)
        self.archivo = carpeta / f"{datetime.now():%Y-%m-%d}.jsonl"
        self.secretos = [s for s in secretos if s]
        self.ejecucion = ejecucion
        self.paso = None

    def limpio(self, v):
        t = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
        for s in self.secretos:
            t = t.replace(s, "***")
        return t

    def _escribir(self, nivel, mensaje, datos):
        ahora = datetime.now().isoformat(timespec="seconds")
        fila = {"t": ahora, "nivel": nivel, "ejecucion": self.ejecucion, "paso": self.paso, "msg": self.limpio(mensaje)}
        if datos:
            fila["datos"] = json.loads(self.limpio(datos))
        with self.archivo.open("a", encoding="utf-8") as f:
            f.write(json.dumps(fila, ensure_ascii=False) + "\n")
        extra = " ".join(f"{k}={self.limpio(v)}" for k, v in (datos or {}).items())
        print(f"{ahora} {nivel.upper():5} {('[' + self.paso + '] ') if self.paso else ''}{self.limpio(mensaje)} {extra}".rstrip(), file=sys.stderr if nivel == "error" else sys.stdout, flush=True)

    def info(self, mensaje, **datos):
        self._escribir("info", mensaje, datos)

    def aviso(self, mensaje, **datos):
        self._escribir("aviso", mensaje, datos)

    def error(self, mensaje, **datos):
        self._escribir("error", mensaje, datos)
