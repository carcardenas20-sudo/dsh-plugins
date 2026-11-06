# dsh-confeccion-xt

Plugin para DeepSeek Harness con tres herramientas que el agente usa solo:

- `costo_prenda`: costo unitario desde materiales, mano de obra e indirectos.
- `precio_venta`: precio mayorista y detal con margen sobre el precio e IVA.
- `rentabilidad_lote`: utilidad y punto de equilibrio de un lote.

Sin dependencias, sin red, sin leer archivos ni claves.

Instalar (perfil web): `dsh plugin --profile web add ./dsh-confeccion-xt-0.1.0.tgz`
Quitar: `dsh plugin --profile web remove dsh-confeccion-xt`
