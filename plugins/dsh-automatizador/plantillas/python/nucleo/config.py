import os
from pathlib import Path

SECRETO = ("PASS", "CLAVE", "TOKEN", "SECRET", "KEY", "API")


def cargar_env(raiz: Path) -> None:
    """Carga .env (si existe) sin pisar variables que ya vengan del sistema/servidor."""
    f = raiz / ".env"
    if not f.exists():
        return
    for linea in f.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        k, v = linea.split("=", 1)
        k, v = k.strip(), v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        os.environ.setdefault(k, v)


def valores_secretos() -> list:
    return [v for k, v in os.environ.items() if v and len(v) >= 4 and any(s in k.upper() for s in SECRETO)]


def faltantes(requeridas) -> list:
    return [k for k in requeridas if not os.environ.get(k)]
