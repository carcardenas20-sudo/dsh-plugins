// Página local de dictado y carga de audios de dsh-transcriptor (se abre en el navegador del PC).
export const pagina = (proyecto) => `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dictado — ${proyecto}</title>
<style>
:root{--bg:#f4f5f2;--panel:#fff;--tinta:#18211e;--suave:#55615c;--linea:#d9ddd6;--acento:#1d5c4f;--rojo:#b3322c;--aviso-bg:#fbf0d9;--aviso:#7a4f08;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111614;--panel:#18201d;--tinta:#e7ece9;--suave:#a9b5af;--linea:#2c3833;--acento:#6cc3ad;--rojo:#f0817b;--aviso-bg:#33290f;--aviso:#e8bb68;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tinta);font:16px/1.55 "Segoe UI",system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:28px 18px 60px;display:grid;gap:18px}
h1{font-size:24px;margin:0}p{margin:0;color:var(--suave)}
.panel{background:var(--panel);border:1px solid var(--linea);border-radius:14px;padding:18px;display:grid;gap:12px}
.fila{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
button{font:inherit;font-weight:600;border-radius:10px;border:1px solid var(--linea);background:var(--panel);color:var(--tinta);padding:10px 16px;cursor:pointer}
button:hover{border-color:var(--acento)}button[disabled]{opacity:.5;cursor:not-allowed}
#grabar{background:var(--acento);border-color:var(--acento);color:var(--panel);min-width:190px;font-size:17px;padding:14px 20px}
#grabar.activo{background:var(--rojo);border-color:var(--rojo)}
#tiempo{font-variant-numeric:tabular-nums;font-size:20px;font-weight:700;min-width:64px}
#estado{min-height:24px;color:var(--suave)}
textarea{width:100%;min-height:150px;font:inherit;padding:12px;border-radius:10px;border:1px solid var(--linea);background:var(--panel);color:var(--tinta);resize:vertical}
.aviso{background:var(--aviso-bg);color:var(--aviso);border-radius:10px;padding:10px 14px;font-size:14.5px}
.aviso[hidden]{display:none}
#soltar{border:2px dashed var(--linea);border-radius:12px;padding:22px;text-align:center;color:var(--suave)}
#soltar.sobre{border-color:var(--acento);color:var(--acento)}
kbd{font:600 13px ui-monospace,Consolas,monospace;border:1px solid var(--linea);border-radius:6px;padding:1px 6px;background:var(--bg)}
ul{margin:0;padding-left:20px;color:var(--suave);font-size:14.5px}
</style></head><body><main>
<div><h1>Dictado</h1><p>Proyecto: ${proyecto}. Todo se transcribe en este computador; el audio no sale de aquí.</p></div>
<div class="aviso" id="motor" hidden></div>
<section class="panel">
  <div class="fila"><button id="grabar">● Empezar a dictar</button><span id="tiempo">00:00</span><span id="estado" role="status"></span></div>
  <label for="texto" style="font-weight:600">Texto</label>
  <textarea id="texto" placeholder="Aquí aparece lo que dictes. Puedes corregirlo antes de usarlo."></textarea>
  <div class="aviso" id="dudas" hidden></div>
  <div class="fila"><button id="copiar" disabled>Copiar</button><button id="guardar" disabled>Guardar corrección</button><button id="limpiar" disabled>Borrar</button></div>
  <ul><li>Para pasarlo a DeepSeek: escribe <kbd>dictado</kbd> en Harness y lo toma solo, o copia y pega.</li><li>Atajo: barra espaciadora para empezar y parar (con el cursor fuera del texto).</li></ul>
</section>
<section class="panel">
  <strong>Transcribir una grabación</strong>
  <div id="soltar">Arrastra aquí un audio o video (WhatsApp, reunión, nota de voz) o <button id="elegir">elige un archivo</button><input type="file" id="archivo" accept="audio/*,video/*,.opus,.ogg,.m4a,.mp3,.wav,.mp4,.webm" hidden></div>
  <p id="estado-archivo" role="status"></p>
</section>
</main>
<script>
(function(){
var base=location.pathname.replace(/\\/$/,"");var $=function(i){return document.getElementById(i)};
var rec=null,trozos=[],inicio=0,reloj=null,flujo=null,ultimoId=null;
function estado(t){$("estado").textContent=t}
function botones(){var v=!!$("texto").value.trim();$("copiar").disabled=!v;$("limpiar").disabled=!v;$("guardar").disabled=!v||!ultimoId}
fetch(base+"/estado").then(function(r){return r.json()}).then(function(j){if(!j.motor){$("motor").hidden=false;$("motor").textContent="El motor de transcripción todavía no está instalado. Pídele a DeepSeek: «prepara el transcriptor»."}}).catch(function(){});
async function empezar(){
  try{flujo=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})}catch(e){estado("No hay permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones.");return}
  trozos=[];rec=new MediaRecorder(flujo);rec.ondataavailable=function(e){if(e.data.size)trozos.push(e.data)};rec.onstop=enviar;rec.start(1000);
  inicio=Date.now();$("grabar").textContent="■ Parar";$("grabar").classList.add("activo");estado("Grabando…");
  reloj=setInterval(function(){var s=Math.floor((Date.now()-inicio)/1000);$("tiempo").textContent=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")},250);
}
function parar(){if(rec&&rec.state!=="inactive")rec.stop();if(flujo)flujo.getTracks().forEach(function(t){t.stop()});clearInterval(reloj);$("grabar").textContent="● Empezar a dictar";$("grabar").classList.remove("activo")}
async function enviar(){
  var blob=new Blob(trozos,{type:rec.mimeType||"audio/webm"});if(blob.size<2000){estado("No se grabó nada.");return}
  $("grabar").disabled=true;estado("Transcribiendo… (la primera vez tarda más porque carga el modelo)");
  try{var r=await fetch(base+"/audio",{method:"POST",headers:{"content-type":blob.type||"audio/webm"},body:blob});var j=await r.json();if(!r.ok)throw new Error(j.error||"falló");
    var t=$("texto");t.value=(t.value.trim()?t.value.trim()+"\\n":"")+j.texto;ultimoId=j.id;
    $("dudas").hidden=!j.dudosos;if(j.dudosos)$("dudas").textContent="Hay "+j.dudosos+" parte(s) que no se oyeron bien: revisa el texto antes de usarlo.";
    estado(j.texto?"Listo. Escribe «dictado» en Harness o copia el texto.":"No se entendió nada. Intenta de nuevo más cerca del micrófono.");
  }catch(e){estado("No se pudo transcribir: "+e.message)}
  $("grabar").disabled=false;botones();
}
$("grabar").onclick=function(){if(rec&&rec.state==="recording")parar();else empezar()};
document.addEventListener("keydown",function(e){if(e.code==="Space"&&!/TEXTAREA|INPUT|BUTTON/.test(e.target.tagName)&&!$("grabar").disabled){e.preventDefault();$("grabar").click()}});
$("texto").oninput=botones;
$("copiar").onclick=function(){navigator.clipboard.writeText($("texto").value).then(function(){estado("Copiado.")},function(){$("texto").select();estado("Selecciona y copia con Ctrl+C.")})};
$("limpiar").onclick=function(){$("texto").value="";ultimoId=null;$("dudas").hidden=true;fetch(base+"/dictado",{method:"DELETE"});botones();estado("Borrado.")};
$("guardar").onclick=function(){fetch(base+"/dictado",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({texto:$("texto").value})}).then(function(r){estado(r.ok?"Corrección guardada: DeepSeek tomará este texto.":"No se pudo guardar.")})};
var caja=$("soltar");function subir(f){if(!f)return;$("estado-archivo").textContent="Subiendo «"+f.name+"»…";
  fetch(base+"/archivo?nombre="+encodeURIComponent(f.name),{method:"POST",headers:{"content-type":f.type||"application/octet-stream"},body:f}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"falló");$("estado-archivo").textContent="En cola. Quedará en "+j.salida+". Pregúntale a DeepSeek «¿cómo va la transcripción?» o espera a que termine: puedes cerrar esta página."})}).catch(function(e){$("estado-archivo").textContent="No se pudo: "+e.message})}
$("elegir").onclick=function(){$("archivo").click()};$("archivo").onchange=function(){subir(this.files[0]);this.value=""};
["dragenter","dragover"].forEach(function(n){caja.addEventListener(n,function(e){e.preventDefault();caja.classList.add("sobre")})});
["dragleave","drop"].forEach(function(n){caja.addEventListener(n,function(e){e.preventDefault();caja.classList.remove("sobre")})});
caja.addEventListener("drop",function(e){subir(e.dataTransfer.files[0])});
})();
</script></body></html>`
