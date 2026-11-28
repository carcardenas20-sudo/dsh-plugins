# Prueba completa en Windows

Recorrido para comprobar dsh-escritorio de punta a punta en un PC con Windows, con un Supabase real. Toma unos 40 minutos.

## Antes

- DeepSeek Harness con **dsh-escritorio** instalado (Plugins → Add plugin).
- Un proyecto de Supabase de prueba, con su URL y su clave pública (`sb_publishable_…`), más un usuario administrador y uno de cada rol.
- Una carpeta vacía, por ejemplo `C:\pruebas\textiles`, abierta en Harness.

## 1. Crear la app

> Crea una app React con Vite llamada "Textiles X" con dos pantallas: Clientes y Pedidos. Conviértela en app de escritorio. Conéctala a Supabase con esta URL y clave pública. Tablas: clientes (nombre, nit, sede Norte/Sur) y pedidos (cliente, prenda, cantidad, valor, estado Nuevo/En corte/Listo, sede). Roles: vendedor (ve y crea lo de su sede) y gerente (ve todo, cambia pedidos y administra usuarios). Pon el inicio de sesión, el indicador de conexión y la pantalla de usuarios para quien los administra.

**Debe pasar:** DeepSeek corre `escritorio_crear` y `escritorio_datos`. Si el proyecto ya tiene las tablas, el SQL no hace nada nuevo: las migraciones ya aplicadas se saltan.

## 2. Probar e instalar

> Pruébala y muéstrame capturas. Luego haz el instalador para este PC.

- [ ] La app abre con el inicio de sesión (en claro y oscuro).
- [ ] Se genera el `.exe` en `escritorio\instaladores\`. Al instalarlo, Windows avisa "Windows protegió su PC" (es normal sin firma: Más información → Ejecutar de todos modos).

## 3. Usuarios y permisos (con la app instalada)

- [ ] Entra el **vendedor de Norte**: ve solo clientes de Norte; si intenta crear uno de Sur, la app no lo deja.
- [ ] Sale e entra el **gerente**: ve las dos sedes. En **Usuarios** crea un vendedor nuevo de Sur. Intenta hacerlo administrador: no lo deja.
- [ ] En **Roles y permisos**, el admin le quita a "vendedor" el permiso de crear clientes. El vendedor (sin cerrar la app) ya no puede crear.

## 4. Tiempo real entre dos equipos

Abre la app en **dos PCs**, o instálala también en un portátil, con usuarios distintos.

- [ ] Un pedido creado en uno aparece en el otro en 1 o 2 segundos, sin recargar.
- [ ] Desconecta el WiFi de uno: el indicador dice "Sin conexión". Crea un pedido y dice "1 cambio por subir". Al reconectar, se sube solo y aparece en el otro.
- [ ] Los dos editan el **mismo pedido**, uno de ellos sin internet. Al reconectar aparece "⚠ 1 conflicto" y deja elegir qué versión queda.

## 5. Automatizaciones y robot

> Haz una automatización que abra https://example.com con un robot, tome una captura y devuelva el título. Que se pueda correr a mano. Pruébala.

- [ ] El robot usa **Edge** (en el registro dice "robot abierto (msedge)").
- [ ] En el panel de Automatizaciones se ve la corrida con la captura.
- [ ] En **Datos privados** se guarda una clave de prueba. El archivo `%APPDATA%\Textiles X\secretos.json` no contiene la clave en texto.

## 6. Errores, historial y versión mínima

- [ ] En la pestaña **Sistema** aparecen los pedidos creados en el **historial de cambios**, con el nombre del equipo.
- [ ] El gerente pone la **versión mínima** en `9.0.0`. Al reabrir la app aparece "Hay que actualizar" y no deja trabajar. Vuelve a dejarla vacía desde el panel de Supabase (tabla `app_config`).

## 7. Página de descargas y aviso de actualización

> La página de descargas será https://<tu-sitio>.netlify.app/. Que avise las versiones nuevas. Empaqueta la 1.0.0.

- [ ] Sube la carpeta `escritorio\sitio\` a Netlify (arrastrar en Deploys). La página detecta Windows y ofrece el `.exe`.
- [ ] Instala esa 1.0.0. Luego: *"Empaqueta la 1.0.1 con la novedad 'Nuevo reporte'"* y sube otra vez la carpeta.
- [ ] Al abrir la 1.0.0 aparece "Hay una versión nueva: 1.0.1" y el botón Descargar abre la página.

## 8. Sin internet de verdad

- [ ] Con la app abierta y sesión iniciada, desconecta el WiFi y **cierra y vuelve a abrir la app**: las pantallas que ya habías visto siguen mostrando sus datos.
- [ ] Sin internet, crea un pedido, edita otro y borra un tercero: los tres cambios se ven al instante en la lista (marcados como pendientes) y el indicador dice "3 cambios por subir".
- [ ] Cierra la app, reconecta el WiFi y ábrela: los cambios se suben solos, en orden, y aparecen en el otro equipo.
- [ ] Con el vendedor de Norte, sin internet, crea un cliente de **Sur** (algo que no tiene permitido). Al reconectar, el indicador muestra "✕ 1 sin subir" y deja **Reintentar** o **Descartar**.

## 9. La misma app en Rust (Tauri) y en Java

> Haz la misma app de escritorio con Tauri (en la carpeta escritorio-rust) y con Java (en escritorio-java). Pruébalas.

- [ ] Si falta Rust o el JDK, la prueba explica qué instalar (`winget install Rustlang.Rustup` y las herramientas de C++; `winget install Microsoft.OpenJDK.21`). La primera compilación de Rust tarda unos minutos.
- [ ] Las dos abren con el mismo inicio de sesión, los mismos datos en vivo y el mismo panel de automatizaciones (el robot usa Edge).
- [ ] *"Haz los instaladores"*: el de Tauri pesa mucho menos que el de Electron.
- [ ] Datos privados: en Tauri quedan en el Administrador de credenciales de Windows; en Java, `secretos.json` solo guarda la clave cifrada (DPAPI).

Si algo falla, copia el mensaje o la captura y pásalo: cada fallo se convierte en una prueba automática nueva.
