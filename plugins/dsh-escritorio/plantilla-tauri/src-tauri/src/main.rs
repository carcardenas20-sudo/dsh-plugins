// App de escritorio con Tauri (generada por dsh-escritorio). Misma idea que la versión Electron, pero más liviana:
// la ventana usa el navegador del sistema (WebView2 en Windows, WebKit en Mac y Linux).
//   · window.escritorio (puente.js) ↔ comando "puente" de este archivo
//   · automatizaciones: el motor de Node (recursos/motor/servidor.cjs) con el Node que viaja en el instalador
//   · actualizaciones con aviso: version.json de la página de descargas del cliente
//   · versión mínima: bloquea la app si la página o la base (app_config) lo piden
//   · datos privados de los robots en el llavero del sistema (Credenciales de Windows, Llavero de Mac)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const PUENTE: &str = include_str!("../../puente.js");
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

struct Motor {
    entrada: Mutex<ChildStdin>,
    esperando: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    contador: AtomicU64,
    proceso: Mutex<Child>,
}

struct Estado {
    config: Value,
    version: String,
    equipo: String,
    datos: PathBuf,
    recursos: PathBuf,
    prueba: Option<PathBuf>,
    motor: Mutex<Option<Arc<Motor>>>,
    actualizacion: Mutex<Value>,
    errores: Mutex<Vec<Value>>,
    bloqueada: AtomicBool,
    avisada: Mutex<Option<String>>,
}

fn texto(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string()).filter(|s| !s.is_empty())
}

fn comparar(a: &str, b: &str) -> std::cmp::Ordering {
    let n = |s: &str| s.split(|c| c == '.' || c == '-').take(3).map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    let (x, y) = (n(a), n(b));
    for i in 0..3 {
        let (p, q) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
        if p != q {
            return p.cmp(&q);
        }
    }
    std::cmp::Ordering::Equal
}

fn registrar(e: &Estado, m: &str) {
    let _ = std::fs::create_dir_all(&e.datos);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(e.datos.join("app.log")) {
        let _ = writeln!(f, "{} {}", ahora(), m);
    }
}

fn ahora() -> String {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{s}")
}

fn registrar_error(app: &AppHandle, origen: &str, mensaje: &str, detalle: &str) {
    let e = app.state::<Estado>();
    let err = json!({ "origen": origen, "mensaje": mensaje.chars().take(1000).collect::<String>(), "detalle": detalle.chars().take(4000).collect::<String>(), "version": e.version, "equipo": e.equipo });
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(e.datos.join("errores.log")) {
        let _ = writeln!(f, "{}", err);
    }
    let mut l = e.errores.lock().unwrap();
    l.push(err.clone());
    if l.len() > 200 {
        l.remove(0);
    }
    let _ = app.emit("error-app", err);
}

fn notificar(app: &AppHandle, titulo: &str, cuerpo: &str) {
    let _ = app.notification().builder().title(titulo.chars().take(120).collect::<String>()).body(cuerpo.chars().take(400).collect::<String>()).show();
}

fn mostrar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// ---------- datos privados de los robots (llavero del sistema) ----------
fn archivo_secretos(e: &Estado) -> PathBuf {
    e.datos.join("secretos.json")
}
fn leer_indice(e: &Estado) -> Value {
    std::fs::read_to_string(archivo_secretos(e)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}))
}
fn guardar_indice(e: &Estado, v: &Value) {
    let _ = std::fs::write(archivo_secretos(e), serde_json::to_string_pretty(v).unwrap_or_default());
}
fn servicio(e: &Estado) -> String {
    texto(&e.config, "id").unwrap_or_else(|| "app-escritorio".into())
}
fn guardar_secreto(e: &Estado, auto: &str, nombre: &str, valor: &str) -> Result<(), String> {
    let mut indice = leer_indice(e);
    let cuenta = format!("{auto}.{nombre}");
    let entrada = keyring::Entry::new(&servicio(e), &cuenta).map_err(|x| x.to_string())?;
    if valor.is_empty() {
        let _ = entrada.delete_credential();
        if let Some(m) = indice.get_mut(auto).and_then(|x| x.as_object_mut()) {
            m.remove(nombre);
        }
    } else {
        match entrada.set_password(valor) {
            Ok(()) => indice[auto][nombre] = json!("llavero"),
            // Linux sin llavero (gnome-keyring/kwallet): se guarda en la carpeta de la app con permisos solo del usuario
            Err(err) => {
                registrar(e, &format!("aviso: sin llavero del sistema ({err}); dato privado en archivo local"));
                indice[auto][nombre] = json!(format!("b64:{}", B64.encode(valor)));
            }
        }
    }
    guardar_indice(e, &indice);
    Ok(())
}
fn leer_secreto(e: &Estado, auto: &str, nombre: &str) -> Option<String> {
    if e.prueba.is_some() {
        if let Some(v) = std::env::var("DSH_ESCRITORIO_SECRETOS").ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| texto(&v, &format!("{auto}.{nombre}"))) {
            return Some(v);
        }
    }
    let marca = leer_indice(e).get(auto).and_then(|m| m.get(nombre)).and_then(|x| x.as_str()).map(String::from)?;
    if let Some(b) = marca.strip_prefix("b64:") {
        return B64.decode(b).ok().and_then(|x| String::from_utf8(x).ok());
    }
    keyring::Entry::new(&servicio(e), &format!("{auto}.{nombre}")).ok()?.get_password().ok()
}

// ---------- motor de automatizaciones ----------
fn ruta_node(e: &Estado) -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    let nombre = if cfg!(windows) { "node.exe" } else { "node" };
    [dir.join(nombre), e.recursos.join(nombre)].into_iter().find(|p| p.exists()).unwrap_or_else(|| PathBuf::from(nombre))
}

fn iniciar_motor(app: &AppHandle) -> Option<Arc<Motor>> {
    let e = app.state::<Estado>();
    let script = e.recursos.join("motor").join("servidor.cjs");
    if !script.exists() || !e.recursos.join("automatizaciones").exists() {
        return None;
    }
    let mut cmd = Command::new(ruta_node(&e));
    cmd.arg(&script).arg(&e.recursos).arg(e.datos.join("automatizaciones")).env("DSH_EQUIPO", &e.equipo).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // sin ventana de consola
    }
    let mut hijo = match cmd.spawn() {
        Ok(h) => h,
        Err(err) => {
            registrar_error(app, "app", &format!("No arrancó el motor de automatizaciones: {err}"), "");
            return None;
        }
    };
    let salida = hijo.stdout.take()?;
    let errores = hijo.stderr.take()?;
    let entrada = hijo.stdin.take()?;
    let motor = Arc::new(Motor { entrada: Mutex::new(entrada), esperando: Mutex::new(HashMap::new()), contador: AtomicU64::new(0), proceso: Mutex::new(hijo) });
    let datos = e.datos.clone();
    std::thread::spawn(move || {
        let _ = std::fs::create_dir_all(&datos);
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(datos.join("motor-salida.log")).ok();
        for l in BufReader::new(errores).lines().map_while(Result::ok) {
            if let Some(f) = f.as_mut() {
                let _ = writeln!(f, "{l}");
            }
        }
    });
    let (a, m) = (app.clone(), motor.clone());
    std::thread::spawn(move || {
        for linea in BufReader::new(salida).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<Value>(&linea) else { continue };
            if let Some(id) = v.get("id").and_then(|x| x.as_u64()) {
                if let Some(tx) = m.esperando.lock().unwrap().remove(&id) {
                    let _ = tx.send(v);
                }
            } else if let Some(pedido) = v.get("pedido").cloned() {
                let est = a.state::<Estado>();
                let valor = if texto(&v, "metodo").as_deref() == Some("secreto") { leer_secreto(&est, &texto(&v, "auto").unwrap_or_default(), &texto(&v, "nombre").unwrap_or_default()) } else { None };
                let _ = writeln!(m.entrada.lock().unwrap(), "{}", json!({ "respuesta": pedido, "valor": valor }));
            } else {
                match texto(&v, "evento").as_deref() {
                    Some("lista") => { let _ = a.emit("automatizaciones", v.get("lista").cloned().unwrap_or(json!([]))); }
                    Some("interfaz") => { let _ = a.emit("automatizacion:evento", v.get("datos").cloned().unwrap_or(Value::Null)); }
                    Some("notificar") => notificar(&a, &texto(&v, "titulo").unwrap_or_default(), &texto(&v, "cuerpo").unwrap_or_default()),
                    Some("error") => registrar_error(&a, "automatizacion", &format!("{}: {}", texto(&v, "id").unwrap_or_default(), texto(&v, "error").unwrap_or_default()), ""),
                    _ => {}
                }
            }
        }
    });
    Some(motor)
}

fn llamar_motor(app: &AppHandle, metodo: &str, args: Value, espera: Duration) -> Result<Value, String> {
    let e = app.state::<Estado>();
    let motor = e.motor.lock().unwrap().clone().ok_or("Esta app no tiene automatizaciones")?;
    let id = motor.contador.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = mpsc::channel();
    motor.esperando.lock().unwrap().insert(id, tx);
    writeln!(motor.entrada.lock().unwrap(), "{}", json!({ "id": id, "metodo": metodo, "args": args })).map_err(|x| x.to_string())?;
    let r = rx.recv_timeout(espera).map_err(|_| "El motor de automatizaciones no respondió".to_string())?;
    if r.get("ok").and_then(|x| x.as_bool()) == Some(true) {
        Ok(r.get("valor").cloned().unwrap_or(Value::Null))
    } else {
        Err(texto(&r, "error").unwrap_or_else(|| "Error del motor".into()))
    }
}

fn abrir_panel(app: &AppHandle, id: Option<String>) {
    let e = app.state::<Estado>();
    let script = format!("window.__PANEL_ID__ = {};", serde_json::to_string(&id).unwrap_or("null".into()));
    if let Some(w) = app.get_webview_window("panel") {
        let _ = w.eval(&format!("{script} location.reload()"));
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let titulo = format!("Automatizaciones · {}", texto(&e.config, "nombre").unwrap_or_default());
    let _ = WebviewWindowBuilder::new(app, "panel", WebviewUrl::App("_motor/index.html".into()))
        .title(titulo)
        .inner_size(1060.0, 720.0)
        .min_inner_size(560.0, 420.0)
        .initialization_script(&format!("{}\n{}\n{}", info_script(&e), script, PUENTE))
        .build();
}

// ---------- actualizaciones con aviso y versión mínima ----------
fn pagina_descargas(e: &Estado) -> Option<String> {
    texto(&e.config, "paginaVersiones").or_else(|| texto(&e.config, "sitio"))
}

fn fijar_actualizacion(app: &AppHandle, cambio: Value) {
    let e = app.state::<Estado>();
    let mut a = e.actualizacion.lock().unwrap();
    if let (Some(obj), Some(c)) = (a.as_object_mut(), cambio.as_object()) {
        for (k, v) in c {
            obj.insert(k.clone(), v.clone());
        }
    }
    let _ = app.emit("actualizacion", a.clone());
}

fn traer_json(url: &str, cabeceras: &[(&str, String)]) -> Option<Value> {
    let mut r = ureq::get(url).timeout(Duration::from_secs(20));
    for (k, v) in cabeceras {
        r = r.set(k, v);
    }
    r.call().ok()?.into_json::<Value>().ok()
}

fn revisar_version(app: &AppHandle, manual: bool) {
    let e = app.state::<Estado>();
    if e.prueba.is_some() || e.bloqueada.load(Ordering::SeqCst) {
        return;
    }
    let mut minimas: Vec<String> = vec![];
    let nombre = texto(&e.config, "nombre").unwrap_or_default();
    if let Some(sitio) = texto(&e.config, "sitio") {
        fijar_actualizacion(app, json!({ "estado": "buscando" }));
        let url = format!("{}/version.json", sitio.trim_end_matches('/'));
        match traer_json(&url, &[]) {
            Some(v) => {
                if let Some(m) = texto(&v, "minima") {
                    minimas.push(m);
                }
                let nueva = texto(&v, "version").unwrap_or_default();
                if !nueva.is_empty() && comparar(&nueva, &e.version).is_gt() {
                    fijar_actualizacion(app, json!({ "estado": "disponible", "version": nueva }));
                    let mut avisada = e.avisada.lock().unwrap();
                    if manual || avisada.as_deref() != Some(nueva.as_str()) {
                        notificar(app, &format!("{nombre} {nueva}"), "Hay una versión nueva. Ábrela desde la app para descargarla.");
                        *avisada = Some(nueva);
                    }
                } else {
                    fijar_actualizacion(app, json!({ "estado": "al-dia" }));
                    if manual {
                        notificar(app, &nombre, &format!("Tienes la última versión ({}).", e.version));
                    }
                }
            }
            None => {
                fijar_actualizacion(app, json!({ "estado": "error", "error": "No se pudo consultar la página de descargas" }));
                if manual {
                    notificar(app, &nombre, "No se pudo buscar actualizaciones. Revisa la conexión.");
                }
            }
        }
    }
    if let (Some(url), Some(clave)) = (e.config.pointer("/supabase/url").and_then(|x| x.as_str()), e.config.pointer("/supabase/clave").and_then(|x| x.as_str())) {
        let consulta = format!("{url}/rest/v1/app_config?clave=eq.version_minima&select=valor");
        if let Some(Value::Array(filas)) = traer_json(&consulta, &[("apikey", clave.to_string()), ("Authorization", format!("Bearer {clave}"))]) {
            if let Some(m) = filas.first().and_then(|f| texto(f, "valor")) {
                minimas.push(m);
            }
        }
    }
    minimas.sort_by(|a, b| comparar(a, b));
    if let Some(minima) = minimas.last() {
        if comparar(&e.version, minima).is_lt() {
            e.bloqueada.store(true, Ordering::SeqCst);
            registrar(&e, &format!("versión {} bloqueada: la mínima es {minima}", e.version));
            if let Some(m) = e.motor.lock().unwrap().take() {
                let _ = m.proceso.lock().unwrap().kill();
            }
            fijar_actualizacion(app, json!({ "estado": "obligatoria", "version": minima }));
            if let Some(w) = app.get_webview_window("main") {
                let q = |s: &str| s.replace('\\', "\\\\").replace('\'', "\\'");
                let _ = w.eval(&format!("location.href = '/_motor/bloqueo.html?actual={}&minima={}&nombre=' + encodeURIComponent('{}')", q(&e.version), q(minima), q(&nombre)));
            }
            mostrar(app);
            notificar(app, &format!("{nombre}: actualización obligatoria"), &format!("Esta versión ({}) ya no se puede usar. Descarga la {minima} o superior.", e.version));
        }
    }
}

// ---------- puente con la interfaz ----------
fn info_script(e: &Estado) -> String {
    let fotos = if cfg!(windows) { "http://fotos.localhost/" } else { "fotos://localhost/" };
    let info = json!({ "version": e.version, "equipo": e.equipo, "plataforma": std::env::consts::OS, "fotos": fotos, "tecnologia": "tauri", "prueba": e.prueba.is_some() });
    format!("window.__ESCRITORIO_INFO__ = {info};")
}

fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or(Value::Null)
}

fn es_texto(ruta: &Path) -> bool {
    let ext = ruta.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
    ["txt", "csv", "json", "md", "xml", "html", "htm", "js", "css", "tsv", "log", "yml", "yaml"].contains(&ext.as_str())
}

fn con_filtros<R: tauri::Runtime>(mut d: tauri_plugin_dialog::FileDialogBuilder<R>, op: &Value) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    if let Some(t) = texto(op, "titulo") {
        d = d.set_title(t);
    }
    if let Some(Value::Array(fs)) = op.get("filtros") {
        for f in fs {
            let ext: Vec<String> = f.get("extensions").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
            let refs: Vec<&str> = ext.iter().map(String::as_str).collect();
            d = d.add_filter(texto(f, "name").unwrap_or_else(|| "Archivos".into()), &refs);
        }
    }
    d
}

#[tauri::command]
async fn puente(app: AppHandle, metodo: String, args: Vec<Value>) -> Result<Value, String> {
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || atender(&a, &metodo, &args)).await.map_err(|x| x.to_string())?
}

fn atender(app: &AppHandle, metodo: &str, args: &[Value]) -> Result<Value, String> {
    let e = app.state::<Estado>();
    let corto = Duration::from_secs(30);
    match metodo {
        "info" => Ok(json!({ "nombre": texto(&e.config, "nombre"), "version": e.version, "plataforma": std::env::consts::OS, "equipo": e.equipo, "tecnologia": "tauri" })),
        "notificar" => { notificar(app, arg(args, 0).as_str().unwrap_or(""), arg(args, 1).as_str().unwrap_or("")); Ok(Value::Null) }
        "externo" => {
            let url = arg(args, 0).as_str().unwrap_or("").to_string();
            if url.starts_with("https://") || url.starts_with("http://") { app.opener().open_url(url, None::<&str>).map_err(|x| x.to_string())?; }
            Ok(Value::Null)
        }
        "archivos:abrir" => {
            let op = arg(args, 0);
            let d = con_filtros(app.dialog().file(), &op);
            let elegidos = if op.get("varios").and_then(|x| x.as_bool()) == Some(true) { d.blocking_pick_files() } else { d.blocking_pick_file().map(|f| vec![f]) };
            let Some(lista) = elegidos else { return Ok(Value::Null) };
            let mut r = vec![];
            for f in lista {
                let ruta = f.into_path().map_err(|x| x.to_string())?;
                let bytes = std::fs::read(&ruta).map_err(|x| x.to_string())?;
                let nombre = ruta.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
                let mut o = json!({ "nombre": nombre, "ruta": ruta.to_string_lossy(), "tamano": bytes.len() });
                if es_texto(&ruta) || op.get("comoTexto").and_then(|x| x.as_bool()) == Some(true) { o["texto"] = json!(String::from_utf8_lossy(&bytes)); } else { o["base64"] = json!(B64.encode(&bytes)); }
                r.push(o);
            }
            Ok(Value::Array(r))
        }
        "archivos:guardar" => {
            let op = arg(args, 0);
            let mut d = con_filtros(app.dialog().file(), &op).set_file_name(texto(&op, "nombre").unwrap_or_else(|| "archivo.txt".into()));
            if let Ok(docs) = app.path().document_dir() { d = d.set_directory(docs); }
            let Some(f) = d.blocking_save_file() else { return Ok(Value::Null) };
            let ruta = f.into_path().map_err(|x| x.to_string())?;
            let bytes = match texto(&op, "base64") { Some(b) => B64.decode(b).map_err(|x| x.to_string())?, None => texto(&op, "contenido").unwrap_or_default().into_bytes() };
            std::fs::write(&ruta, bytes).map_err(|x| x.to_string())?;
            Ok(json!({ "ruta": ruta.to_string_lossy(), "nombre": ruta.file_name().map(|x| x.to_string_lossy().to_string()) }))
        }
        "archivos:mostrar" => { if let Some(r) = arg(args, 0).as_str() { let _ = app.opener().reveal_item_in_dir(r); } Ok(Value::Null) }
        "errores-pendientes" => Ok(Value::Array(std::mem::take(&mut *e.errores.lock().unwrap()))),
        "version:abrir-descargas" | "actualizacion:instalar" => {
            if let Some(url) = pagina_descargas(&e) { registrar(&e, &format!("abriendo la página de descargas: {url}")); let _ = app.opener().open_url(url, None::<&str>); }
            Ok(Value::Null)
        }
        "inicio-sistema" => {
            let al = app.autolaunch();
            if let Some(b) = arg(args, 0).as_bool() { let _ = if b { al.enable() } else { al.disable() }; }
            Ok(json!(al.is_enabled().unwrap_or(false)))
        }
        "actualizacion:estado" => { let mut a = e.actualizacion.lock().unwrap().clone(); a["version_actual"] = json!(e.version); Ok(a) }
        "actualizacion:buscar" => { let a = app.clone(); std::thread::spawn(move || revisar_version(&a, true)); Ok(Value::Null) }
        "auto:lista" => if e.motor.lock().unwrap().is_some() { llamar_motor(app, "lista", json!([]), corto) } else { Ok(json!([])) },
        "auto:ejecutar" => llamar_motor(app, "ejecutar", json!([arg(args, 0), arg(args, 1)]), corto),
        "auto:activar" => llamar_motor(app, "activar", json!([arg(args, 0), arg(args, 1)]), corto),
        "auto:cancelar" => llamar_motor(app, "cancelar", json!([arg(args, 0)]), corto),
        "auto:historial" => llamar_motor(app, "historial", json!([arg(args, 0), arg(args, 1)]), corto),
        "auto:sesion" => if e.motor.lock().unwrap().is_some() { llamar_motor(app, "sesion", json!([arg(args, 0), arg(args, 1)]), corto) } else { Ok(json!(false)) },
        "auto:panel" => { abrir_panel(app, arg(args, 0).as_str().map(String::from)); Ok(json!(true)) }
        "auto:abrir-archivo" => {
            let ruta = PathBuf::from(arg(args, 0).as_str().unwrap_or(""));
            let base = e.datos.join("automatizaciones");
            if ruta.starts_with(&base) && ruta.exists() { let _ = app.opener().open_path(ruta.to_string_lossy(), None::<&str>); }
            Ok(Value::Null)
        }
        "auto:secretos" => {
            let id = arg(args, 0).as_str().unwrap_or("").to_string();
            Ok(json!(leer_indice(&e).get(&id).and_then(|m| m.as_object()).map(|m| m.keys().cloned().collect::<Vec<_>>()).unwrap_or_default()))
        }
        "auto:secreto-guardar" => {
            let id = arg(args, 0).as_str().unwrap_or("").to_string();
            guardar_secreto(&e, &id, arg(args, 1).as_str().unwrap_or(""), arg(args, 2).as_str().unwrap_or(""))?;
            atender(app, "auto:secretos", &[json!(id)])
        }
        "prueba:informe" => { let a = app.clone(); let informe = arg(args, 0); std::thread::spawn(move || terminar_prueba(&a, informe)); Ok(Value::Null) }
        _ => Err(format!("No existe {metodo}")),
    }
}

// ---------- modo prueba (escritorio_probar) ----------
fn captura(destino: &Path) -> bool {
    // Linux con pantalla virtual: foto de la pantalla. En Windows y Mac la prueba se hace sin capturas.
    cfg!(target_os = "linux") && Command::new("import").args(["-window", "root", "-trim", "+repage"]).arg(destino).status().map(|s| s.success()).unwrap_or(false)
}

fn terminar_prueba(app: &AppHandle, informe: Value) {
    let e = app.state::<Estado>();
    let Some(carpeta) = e.prueba.clone() else { return };
    let _ = std::fs::create_dir_all(&carpeta);
    let mut errores: Vec<Value> = informe.get("errores").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let mut capturas = vec![];
    std::thread::sleep(Duration::from_millis(800));
    let f = carpeta.join("ventana-claro.png");
    if captura(&f) { capturas.push(json!(f.to_string_lossy())); }
    if texto(&informe, "texto").is_none() { errores.push(json!("la ventana quedó en blanco")); }
    let mut autos = Value::Null;
    if e.motor.lock().unwrap().is_some() {
        let solo: Vec<String> = std::env::var("DSH_ESCRITORIO_PRUEBA_AUTOS").unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(String::from).collect();
        match llamar_motor(app, "probar", json!([solo]), Duration::from_secs(300)) {
            Ok(v) => {
                for x in v.as_array().cloned().unwrap_or_default() {
                    if x.get("ok").and_then(|o| o.as_bool()) == Some(false) { errores.push(json!(format!("automatización {}: {}", texto(&x, "id").unwrap_or_default(), texto(&x, "error").unwrap_or_default()))); }
                }
                let primera = v.as_array().and_then(|l| l.iter().find(|x| x.get("ok").is_some()).and_then(|x| texto(x, "id")));
                autos = v;
                abrir_panel(app, primera);
                std::thread::sleep(Duration::from_millis(3000));
                let f = carpeta.join("panel-claro.png");
                if captura(&f) { capturas.push(json!(f.to_string_lossy())); }
            }
            Err(err) => errores.push(json!(format!("motor: {err}"))),
        }
    }
    let res = json!({
        "nombre": texto(&e.config, "nombre"), "version": e.version, "plataforma": std::env::consts::OS, "tecnologia": "tauri",
        "titulo": informe.get("titulo"), "texto": informe.get("texto").cloned().unwrap_or(json!("")), "puente": informe.get("puente").cloned().unwrap_or(json!(false)),
        "bandeja": app.tray_by_id("bandeja").is_some(), "atajo": Value::Null, "errores": errores, "capturas": capturas, "automatizaciones": autos,
    });
    let _ = std::fs::write(carpeta.join("resultado.json"), serde_json::to_string_pretty(&res).unwrap_or_default());
    let codigo = if res["errores"].as_array().map(|l| l.is_empty()).unwrap_or(false) { 0 } else { 1 };
    salir(app, codigo);
}

fn salir(app: &AppHandle, codigo: i32) {
    if let Some(m) = app.state::<Estado>().motor.lock().unwrap().take() {
        let _ = writeln!(m.entrada.lock().unwrap(), "{}", json!({ "id": 0, "metodo": "salir" }));
        std::thread::sleep(Duration::from_millis(200));
        let _ = m.proceso.lock().unwrap().kill();
    }
    app.exit(codigo);
}

fn main() {
    let mut builder = tauri::Builder::default();
    // Una sola instancia: abrirla otra vez muestra la ventana que ya estaba.
    if std::env::var("DSH_ESCRITORIO_PRUEBA").is_err() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| mostrar(app)));
    }
    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .register_uri_scheme_protocol("fotos", |ctx, pedido| {
            // capturas de pantalla de los robots, para el panel de automatizaciones
            let e = ctx.app_handle().state::<Estado>();
            let nombre = pedido.uri().path().rsplit('/').next().unwrap_or("").to_string();
            let nombre = nombre.replace("%20", " ");
            let ruta = e.datos.join("automatizaciones").join("capturas").join(Path::new(&nombre).file_name().unwrap_or_default());
            match std::fs::read(&ruta) {
                Ok(b) => tauri::http::Response::builder().header("Content-Type", "image/png").body(b).unwrap(),
                Err(_) => tauri::http::Response::builder().status(404).body(vec![]).unwrap(),
            }
        })
        .invoke_handler(tauri::generate_handler![puente])
        .setup(|app| {
            let h = app.handle().clone();
            let recursos = app.path().resource_dir()?.join("recursos");
            let config: Value = std::fs::read_to_string(recursos.join("escritorio.config.json")).ok().and_then(|t| serde_json::from_str(&t).ok())
                .or_else(|| serde_json::from_str(include_str!("../../escritorio.config.json")).ok()).unwrap_or(json!({}));
            let prueba = std::env::var("DSH_ESCRITORIO_PRUEBA").ok().filter(|s| !s.is_empty()).map(PathBuf::from);
            // en la prueba, datos aparte: no toca los del usuario
            let datos = match &prueba { Some(p) => p.join("datos"), None => app.path().app_data_dir()? };
            let _ = std::fs::create_dir_all(&datos);
            let equipo = texto(&config, "equipo").unwrap_or_else(|| gethostname::gethostname().to_string_lossy().to_string());
            app.manage(Estado {
                version: app.package_info().version.to_string(), equipo, datos: datos.clone(), recursos, prueba: prueba.clone(), config: config.clone(),
                motor: Mutex::new(None), actualizacion: Mutex::new(json!({ "estado": "inactivo" })), errores: Mutex::new(vec![]), bloqueada: AtomicBool::new(false), avisada: Mutex::new(None),
            });
            let e = h.state::<Estado>();
            let anterior = std::panic::take_hook();
            let ruta_errores = datos.join("errores.log");
            std::panic::set_hook(Box::new(move |p| { if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&ruta_errores) { let _ = writeln!(f, "{}", json!({ "origen": "app", "mensaje": p.to_string() })); } anterior(p) }));

            let ancho = config.get("ancho").and_then(|x| x.as_f64()).unwrap_or(1280.0);
            let alto = config.get("alto").and_then(|x| x.as_f64()).unwrap_or(820.0);
            let url = match texto(&config, "url") { Some(u) => WebviewUrl::External(u.parse().map_err(|_| "url inválida")?), None => WebviewUrl::App("index.html".into()) };
            let ventana = WebviewWindowBuilder::new(app, "main", url)
                .title(texto(&config, "nombre").unwrap_or_else(|| "App".into()))
                .inner_size(ancho, alto)
                .min_inner_size(config.get("minAncho").and_then(|x| x.as_f64()).unwrap_or(420.0), config.get("minAlto").and_then(|x| x.as_f64()).unwrap_or(520.0))
                .initialization_script(&format!("{}\n{}", info_script(&e), PUENTE))
                .build()?;

            *e.motor.lock().unwrap() = iniciar_motor(&h);
            let bandeja = config.get("bandeja").and_then(|x| x.as_bool()).unwrap_or(true);
            if bandeja {
                let abrir = MenuItem::with_id(app, "abrir", "Abrir", true, None::<&str>)?;
                let autos = MenuItem::with_id(app, "autos", "Automatizaciones", e.motor.lock().unwrap().is_some(), None::<&str>)?;
                let buscar = MenuItem::with_id(app, "buscar", "Buscar actualizaciones", true, None::<&str>)?;
                let cerrar = MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&abrir, &autos, &buscar, &cerrar])?;
                let mut t = TrayIconBuilder::with_id("bandeja").menu(&menu).tooltip(texto(&config, "nombre").unwrap_or_default())
                    .on_menu_event(|app, ev| match ev.id().as_ref() {
                        "abrir" => mostrar(app),
                        "autos" => abrir_panel(app, None),
                        "buscar" => { let a = app.clone(); std::thread::spawn(move || revisar_version(&a, true)); }
                        "salir" => salir(app, 0),
                        _ => {}
                    })
                    .on_tray_icon_event(|t, ev| if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev { mostrar(t.app_handle()) });
                if let Some(i) = app.default_window_icon() { t = t.icon(i.clone()); }
                t.build(app)?;
                // cerrar la ventana la esconde: la app sigue en la bandeja (y las automatizaciones corriendo)
                let w = ventana.clone();
                ventana.on_window_event(move |ev| if let WindowEvent::CloseRequested { api, .. } = ev { api.prevent_close(); let _ = w.hide(); });
            }

            if let Some(carpeta) = prueba {
                let a = h.clone();
                let limite = if e.motor.lock().unwrap().is_some() { 330 } else { 90 };
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(limite));
                    let _ = std::fs::create_dir_all(&carpeta);
                    let _ = std::fs::write(carpeta.join("resultado.json"), json!({ "errores": [format!("la prueba superó {limite} s (¿la página no cargó?)")], "capturas": [] }).to_string());
                    a.exit(1);
                });
            } else if texto(&config, "sitio").is_some() || config.pointer("/supabase/url").is_some() {
                let a = h.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(4));
                    let mut vueltas = 0u32;
                    loop {
                        revisar_version(&a, false);
                        vueltas += 1;
                        std::thread::sleep(Duration::from_secs(30 * 60)); // cada 30 min (la versión nueva se avisa una sola vez)
                        if vueltas > 100_000 { break; }
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("no pude iniciar la app")
        .run(|app, ev| {
            if let tauri::RunEvent::ExitRequested { .. } = ev {
                if let Some(m) = app.state::<Estado>().motor.lock().unwrap().take() { let _ = m.proceso.lock().unwrap().kill(); }
            }
        });
}
