"""{{NOMBRE}} — {{DESCRIPCION}}

Uso:
  python main.py --prueba     # hace todo pero NO envía ni modifica nada externo
  python main.py              # ejecución real
  python main.py --forzar     # ignora el registro de "ya hecho" (re-procesa todo)
"""
import argparse
import sys

from nucleo import ejecutar_automatizacion
import tarea


def main() -> int:
    for s in (sys.stdout, sys.stderr):  # tildes bien en la consola de Windows
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    p = argparse.ArgumentParser(description="{{DESCRIPCION}}")
    p.add_argument("--prueba", action="store_true", help="modo prueba: no envía ni modifica nada externo")
    p.add_argument("--forzar", action="store_true", help="re-procesar aunque ya esté marcado como hecho")
    a = p.parse_args()
    return ejecutar_automatizacion("{{NOMBRE}}", tarea.ejecutar, prueba=a.prueba, forzar=a.forzar, requeridas=tarea.VARIABLES_REQUERIDAS)


if __name__ == "__main__":
    sys.exit(main())
