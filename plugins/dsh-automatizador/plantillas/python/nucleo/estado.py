import sqlite3
from datetime import datetime
from pathlib import Path


class Estado:
    """Recuerda lo ya procesado (SQLite) para no repetir trabajo si la ejecución se cae a la mitad."""

    def __init__(self, archivo: Path):
        archivo.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(archivo)
        self.db.execute("CREATE TABLE IF NOT EXISTS hechos (clave TEXT PRIMARY KEY, fecha TEXT, detalle TEXT)")
        self.db.commit()

    def ya_hecho(self, clave: str) -> bool:
        return self.db.execute("SELECT 1 FROM hechos WHERE clave = ?", (clave,)).fetchone() is not None

    def marcar(self, clave: str, detalle: str = "") -> None:
        self.db.execute("INSERT OR REPLACE INTO hechos VALUES (?, ?, ?)", (clave, datetime.now().isoformat(timespec="seconds"), detalle))
        self.db.commit()

    def cerrar(self):
        self.db.close()
