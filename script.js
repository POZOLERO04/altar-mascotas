// ---------- Base de datos (IndexedDB: guarda fotos sin límite de localStorage) ----------
const DB_NOMBRE = "altar-mascotas";
const ALMACEN = "mascotas";
let db;

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(ALMACEN, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(modo, accion) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(ALMACEN, modo);
    const req = accion(t.objectStore(ALMACEN));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

const obtenerTodas = () => tx("readonly", (s) => s.getAll());
const guardarMascota = (m) => tx("readwrite", (s) => s.put(m));
const borrarMascota = (id) => tx("readwrite", (s) => s.delete(id));

// ---------- Utilidades ----------
const $ = (sel) => document.querySelector(sel);

function nuevoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Reduce la foto a un tamaño razonable para que el altar cargue rápido.
async function redimensionar(archivo, max = 900) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("No se pudo leer la imagen."));
    i.src = URL.createObjectURL(archivo);
  });
  const escala = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * escala);
  canvas.height = Math.round(img.height * escala);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
}

function anio(fecha) {
  return fecha ? fecha.slice(0, 4) : "";
}

function textoFechas(m) {
  const a = anio(m.llegada), b = anio(m.partida);
  if (a && b) return `${a} – ${b}`;
  if (b) return `† ${b}`;
  if (a) return `Desde ${a}`;
  return "";
}

const blobABase64 = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.readAsDataURL(blob);
});

const base64ABlob = (dataUrl) => fetch(dataUrl).then((r) => r.blob());

// ---------- Render ----------
const urlsActivas = [];

async function render() {
  const mascotas = (await obtenerTodas()).sort((a, b) => a.creada - b.creada);
  urlsActivas.splice(0).forEach(URL.revokeObjectURL);
  galerias.length = 0;

  const cont = $("#retratos");
  cont.innerHTML = "";
  $("#vacio").hidden = mascotas.length > 0;

  for (const m of mascotas) {
    const art = document.createElement("article");
    art.className = "retrato";

    const marco = document.createElement("div");
    marco.className = "marco";
    const fotos = fotosDe(m);
    if (fotos.length) {
      marco.append(crearGaleria(fotos, m.nombre));
    } else {
      const sin = document.createElement("div");
      sin.className = "foto sin-foto";
      sin.textContent = m.especie || "🐾";
      marco.append(sin);
    }
    const editar = document.createElement("button");
    editar.className = "editar";
    editar.title = `Editar a ${m.nombre}`;
    editar.setAttribute("aria-label", `Editar a ${m.nombre}`);
    editar.textContent = "✎";
    editar.onclick = () => abrirDialogo(m);
    marco.append(editar);

    const placa = document.createElement("div");
    placa.className = "placa";
    const h3 = document.createElement("h3");
    h3.textContent = `${m.nombre} ${m.especie || ""}`.trim();
    placa.append(h3);
    const fechas = textoFechas(m);
    if (fechas) placa.append(parrafo("fechas", fechas));
    if (m.ofrenda) placa.append(parrafo("ofrenda", `Su ofrenda: ${m.ofrenda}`));
    if (m.mensaje) placa.append(parrafo("mensaje", `“${m.mensaje}”`));

    const velaBtn = document.createElement("button");
    velaBtn.className = "vela-boton";
    const vela = document.createElement("span");
    vela.className = "vela" + (m.velaEncendida ? " encendida" : "");
    vela.innerHTML = '<span class="llama"></span>';
    const etiqueta = document.createElement("span");
    const actualizarEtiqueta = () => {
      etiqueta.textContent = m.velaEncendida ? "Su vela está encendida" : "Encender una vela";
      velaBtn.setAttribute("aria-pressed", String(!!m.velaEncendida));
    };
    actualizarEtiqueta();
    velaBtn.append(vela, etiqueta);
    velaBtn.onclick = async () => {
      m.velaEncendida = !m.velaEncendida;
      vela.classList.toggle("encendida", m.velaEncendida);
      actualizarEtiqueta();
      if (m.velaEncendida) lluviaPetalos(14);
      mostrarDiapositiva(false);
      await guardarMascota(m);
    };

    art.id = `mascota-${m.id}`;
    art.append(marco, placa, velaBtn);
    cont.append(art);
  }
  actualizarWidget(mascotas);
}

// Las mascotas guardadas antes tenían una sola "foto"; ahora es una lista "fotos".
function fotosDe(m) {
  return m.fotos || (m.foto ? [m.foto] : []);
}

const galerias = [];

function crearGaleria(fotos, nombre) {
  const gal = document.createElement("div");
  gal.className = "galeria";
  const imgs = fotos.map((blob, i) => {
    const img = document.createElement("img");
    img.className = "foto" + (i === 0 ? " activa" : "");
    img.alt = `Foto ${i + 1} de ${nombre}`;
    const url = URL.createObjectURL(blob);
    urlsActivas.push(url);
    img.src = url;
    gal.append(img);
    return img;
  });
  if (fotos.length < 2) return gal;

  let actual = 0;
  const puntos = document.createElement("div");
  puntos.className = "puntos";
  const botonesPunto = fotos.map((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", `Ver foto ${i + 1}`);
    b.onclick = () => ir(i);
    puntos.append(b);
    return b;
  });

  function ir(i) {
    actual = (i + fotos.length) % fotos.length;
    imgs.forEach((img, j) => img.classList.toggle("activa", j === actual));
    botonesPunto.forEach((b, j) => b.classList.toggle("activo", j === actual));
  }

  const flecha = (texto, delta, clase) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "flecha " + clase;
    b.textContent = texto;
    b.setAttribute("aria-label", delta < 0 ? "Foto anterior" : "Foto siguiente");
    b.onclick = () => ir(actual + delta);
    return b;
  };

  gal.append(flecha("‹", -1, "izq"), flecha("›", 1, "der"), puntos);
  ir(0);
  galerias.push({ gal, siguiente: () => ir(actual + 1) });
  return gal;
}

// Las fotos pasan solas, despacio, salvo cuando la persona está mirando una.
setInterval(() => {
  for (const g of galerias) {
    if (g.gal.isConnected && !g.gal.matches(":hover")) g.siguiente();
  }
}, 6000);

function parrafo(clase, texto) {
  const p = document.createElement("p");
  p.className = clase;
  p.textContent = texto;
  return p;
}

// ---------- Diálogo agregar / editar ----------
const dialogo = $("#dialogo");
const form = $("#formulario");
const MAX_FOTOS = 12;
let editando = null;
let fotosEdit = [];
let urlsMiniaturas = [];

function pintarMiniaturas() {
  urlsMiniaturas.splice(0).forEach(URL.revokeObjectURL);
  const cont = $("#miniaturas");
  cont.querySelectorAll(".miniatura").forEach((el) => el.remove());
  const agregar = $("#agregarFoto");

  fotosEdit.forEach((blob, i) => {
    const div = document.createElement("div");
    div.className = "miniatura" + (i === 0 ? " principal" : "");
    const img = document.createElement("img");
    const url = URL.createObjectURL(blob);
    urlsMiniaturas.push(url);
    img.src = url;
    img.alt = `Foto ${i + 1}`;
    div.append(img);

    if (i === 0) {
      const etiqueta = document.createElement("span");
      etiqueta.className = "etiqueta-principal";
      etiqueta.textContent = "Principal";
      div.append(etiqueta);
    } else {
      const estrella = document.createElement("button");
      estrella.type = "button";
      estrella.className = "mini-btn estrella";
      estrella.title = "Usar como foto principal";
      estrella.setAttribute("aria-label", "Usar como foto principal");
      estrella.textContent = "★";
      estrella.onclick = () => {
        fotosEdit.unshift(fotosEdit.splice(i, 1)[0]);
        pintarMiniaturas();
      };
      div.append(estrella);
    }

    const quitar = document.createElement("button");
    quitar.type = "button";
    quitar.className = "mini-btn quitar";
    quitar.title = "Quitar esta foto";
    quitar.setAttribute("aria-label", "Quitar esta foto");
    quitar.textContent = "×";
    quitar.onclick = () => {
      fotosEdit.splice(i, 1);
      pintarMiniaturas();
    };
    div.append(quitar);
    cont.insertBefore(div, agregar);
  });

  agregar.hidden = fotosEdit.length >= MAX_FOTOS;
  $("#ayudaFotos").textContent = fotosEdit.length
    ? `${fotosEdit.length} de ${MAX_FOTOS} fotos. Toque ★ para elegir la principal.`
    : "Puede elegir varias a la vez o arrastrarlas aquí. La primera es la principal.";
}

function abrirDialogo(m = null) {
  editando = m;
  fotosEdit = m ? [...fotosDe(m)] : [];
  form.reset();
  $("#error").hidden = true;
  $("#tituloDialogo").textContent = m ? `Editar a ${m.nombre}` : "Agregar al altar";
  $("#btnGuardar").textContent = m ? "Guardar cambios" : "Colocar en el altar";
  $("#btnEliminar").hidden = !m;
  if (m) {
    for (const campo of ["nombre", "especie", "llegada", "partida", "ofrenda", "mensaje"]) {
      const valor = m[campo] || "";
      form.elements[campo].value = campo === "llegada" || campo === "partida" ? anio(valor) : valor;
    }
  }
  pintarMiniaturas();
  dialogo.showModal();
}

async function tomarFotos(archivos) {
  const imagenes = [...archivos].filter((a) => a.type.startsWith("image/"));
  if (!imagenes.length) return mostrarError("Esos archivos no parecen ser imágenes.");
  $("#error").hidden = true;
  const espacio = MAX_FOTOS - fotosEdit.length;
  if (imagenes.length > espacio) {
    mostrarError(`Solo caben ${MAX_FOTOS} fotos por mascota; se agregaron las primeras ${espacio}.`);
  }
  for (const archivo of imagenes.slice(0, espacio)) {
    try {
      fotosEdit.push(await redimensionar(archivo));
    } catch (e) {
      mostrarError(e.message);
    }
  }
  pintarMiniaturas();
}

function mostrarError(msg) {
  const el = $("#error");
  el.textContent = msg;
  el.hidden = false;
}

$("#inputFoto").addEventListener("change", async (e) => {
  await tomarFotos(e.target.files);
  e.target.value = "";
});

const zona = $("#zonaFotos");
zona.addEventListener("dragover", (e) => { e.preventDefault(); zona.classList.add("arrastrando"); });
zona.addEventListener("dragleave", () => zona.classList.remove("arrastrando"));
zona.addEventListener("drop", (e) => {
  e.preventDefault();
  zona.classList.remove("arrastrando");
  tomarFotos(e.dataTransfer.files);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form));
  d.nombre = d.nombre.trim();
  if (!d.nombre) return mostrarError("Escriba su nombre.");
  if (d.llegada && d.partida && Number(d.partida) < Number(d.llegada)) {
    return mostrarError("El año en que partió es anterior al año en que llegó.");
  }
  const m = editando
    ? { ...editando, ...d }
    : { id: nuevoId(), creada: Date.now(), velaEncendida: true, ...d };
  m.fotos = fotosEdit;
  delete m.foto;
  await guardarMascota(m);
  dialogo.close();
  await render();
  if (!editando) lluviaPetalos(30);
});

$("#btnCancelar").onclick = () => dialogo.close();

$("#btnEliminar").onclick = async () => {
  if (!editando) return;
  if (!confirm(`¿Quitar a ${editando.nombre} del altar? Esta acción no se puede deshacer.`)) return;
  await borrarMascota(editando.id);
  dialogo.close();
  render();
};

$("#btnAgregar").onclick = () => abrirDialogo();
$("#btnAgregarVacio").onclick = () => abrirDialogo();

// ---------- Respaldo ----------
$("#btnExportar").onclick = async () => {
  const mascotas = await obtenerTodas();
  if (!mascotas.length) return alert("Aún no hay mascotas en el altar.");
  const datos = await Promise.all(mascotas.map(async ({ foto, ...m }) => ({
    ...m,
    fotos: await Promise.all(fotosDe({ foto, ...m }).map(blobABase64)),
  })));
  const blob = new Blob([JSON.stringify({ version: 2, mascotas: datos })], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `altar-mascotas-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$("#inputImportar").addEventListener("change", async (e) => {
  const archivo = e.target.files[0];
  e.target.value = "";
  if (!archivo) return;
  try {
    const { mascotas } = JSON.parse(await archivo.text());
    if (!Array.isArray(mascotas)) throw new Error();
    for (const m of mascotas) {
      if (!m.id || !m.nombre) continue;
      // Los respaldos versión 1 traen una sola "foto".
      const lista = m.fotos || (m.foto ? [m.foto] : []);
      m.fotos = await Promise.all(lista.map(base64ABlob));
      delete m.foto;
      await guardarMascota(m);
    }
    await render();
    alert(`Se restauraron ${mascotas.length} mascota(s).`);
  } catch {
    alert("No se pudo leer el respaldo. Asegúrese de elegir un archivo creado con “Guardar respaldo”.");
  }
});

// ---------- Decoración ----------
function papelPicado() {
  const colores = ["--rosa", "--cempasuchil", "--morado", "--verde", "--azul"];
  const cont = document.querySelector(".papel-picado");
  const n = Math.ceil(window.innerWidth / 70) + 2;
  cont.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const b = document.createElement("div");
    b.className = "bandera";
    b.style.background = `var(${colores[i % colores.length]})`;
    b.style.animationDelay = `${(i % 5) * -0.7}s`;
    cont.append(b);
  }
}

function lluviaPetalos(cantidad) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cont = $("#petalos");
  for (let i = 0; i < cantidad; i++) {
    const p = document.createElement("span");
    p.className = "petalo";
    p.style.left = Math.random() * 100 + "vw";
    p.style.setProperty("--dx", (Math.random() * 160 - 80) + "px");
    p.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
    p.style.animationDuration = 4 + Math.random() * 4 + "s";
    p.style.animationDelay = Math.random() * 2 + "s";
    p.style.background = Math.random() < 0.25 ? "var(--rosa)" : "var(--cempasuchil)";
    p.addEventListener("animationend", () => p.remove());
    cont.append(p);
  }
}

// ---------- Mini altar flotante ----------
// Recorre las fotos de todas las mascotas. Se puede arrastrar, minimizar a una
// burbuja u ocultar; su posición se recuerda en este dispositivo.
const CLAVE_WIDGET = "altar-widget";
const widget = $("#widget");
const burbuja = $("#burbuja");
let estadoWidget = { modo: "abierto", x: null, y: null };
try { Object.assign(estadoWidget, JSON.parse(localStorage.getItem(CLAVE_WIDGET))); } catch {}

let diapositivas = [];
let urlsWidget = [];
let indiceWidget = 0;
let imgVisible = $("#widgetImgA");

function guardarEstadoWidget() {
  try { localStorage.setItem(CLAVE_WIDGET, JSON.stringify(estadoWidget)); } catch {}
}

function actualizarWidget(mascotas) {
  urlsWidget.splice(0).forEach(URL.revokeObjectURL);
  diapositivas = [];
  for (const m of mascotas) {
    for (const blob of fotosDe(m)) {
      const url = URL.createObjectURL(blob);
      urlsWidget.push(url);
      diapositivas.push({ m, url });
    }
  }
  indiceWidget = Math.min(indiceWidget, Math.max(0, diapositivas.length - 1));
  mostrarDiapositiva(false);
  aplicarModoWidget();
}

function mostrarDiapositiva(conTransicion = true) {
  const d = diapositivas[indiceWidget];
  if (!d) return;
  const siguiente = imgVisible.id === "widgetImgA" ? $("#widgetImgB") : $("#widgetImgA");
  const destino = conTransicion ? siguiente : imgVisible;
  destino.src = d.url;
  destino.alt = `Foto de ${d.m.nombre}`;
  if (conTransicion) {
    siguiente.classList.add("activa");
    imgVisible.classList.remove("activa");
    imgVisible = siguiente;
  } else {
    imgVisible.classList.add("activa");
  }
  $("#burbujaImg").src = d.url;
  $("#widgetNombre").textContent = `${d.m.nombre} ${d.m.especie || ""}`.trim();
  $("#widgetFechas").textContent = textoFechas(d.m);
  $("#widgetVela").classList.toggle("encendida", !!d.m.velaEncendida);
}

setInterval(() => {
  if (diapositivas.length < 2 || widget.hidden || widget.matches(":hover")) return;
  indiceWidget = (indiceWidget + 1) % diapositivas.length;
  mostrarDiapositiva();
}, 5000);

function aplicarModoWidget() {
  const hay = diapositivas.length > 0;
  widget.hidden = !hay || estadoWidget.modo !== "abierto";
  burbuja.hidden = !hay || estadoWidget.modo !== "burbuja";
  $("#btnWidget").hidden = !hay;
  $("#btnWidget").textContent = estadoWidget.modo === "oculto" ? "🕯️ Mostrar mini altar" : "🕯️ Ocultar mini altar";
  colocar(widget.hidden ? burbuja : widget);
}

// Mantiene el elemento dentro de la pantalla; sin posición guardada va abajo a la derecha.
function colocar(el) {
  if (el.hidden) return;
  const margen = 12;
  const ancho = el.offsetWidth, alto = el.offsetHeight;
  const x = estadoWidget.x ?? window.innerWidth - ancho - margen;
  const y = estadoWidget.y ?? window.innerHeight - alto - margen;
  el.style.left = Math.max(margen, Math.min(x, window.innerWidth - ancho - margen)) + "px";
  el.style.top = Math.max(margen, Math.min(y, window.innerHeight - alto - margen)) + "px";
}

// Arrastre con dedo o mouse. Devuelve true si hubo movimiento (para no confundirlo con un toque).
function hacerArrastrable(asa, el, alTocar) {
  asa.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".widget-btn")) return;
    const inicio = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop };
    let movido = false;
    asa.setPointerCapture(e.pointerId);
    const mover = (ev) => {
      const dx = ev.clientX - inicio.x, dy = ev.clientY - inicio.y;
      if (!movido && Math.hypot(dx, dy) < 6) return;
      movido = true;
      el.classList.add("arrastrando");
      estadoWidget.x = inicio.left + dx;
      estadoWidget.y = inicio.top + dy;
      colocar(el);
    };
    const soltar = () => {
      asa.removeEventListener("pointermove", mover);
      asa.removeEventListener("pointerup", soltar);
      asa.removeEventListener("pointercancel", soltar);
      el.classList.remove("arrastrando");
      if (movido) {
        estadoWidget.x = el.offsetLeft;
        estadoWidget.y = el.offsetTop;
        guardarEstadoWidget();
      } else if (alTocar) {
        alTocar();
      }
    };
    asa.addEventListener("pointermove", mover);
    asa.addEventListener("pointerup", soltar);
    asa.addEventListener("pointercancel", soltar);
  });
}

function cambiarModo(modo) {
  estadoWidget.modo = modo;
  guardarEstadoWidget();
  aplicarModoWidget();
}

hacerArrastrable($("#widgetBarra"), widget);
hacerArrastrable($("#widgetFoto"), widget, () => {
  const d = diapositivas[indiceWidget];
  const tarjeta = d && document.getElementById(`mascota-${d.m.id}`);
  if (!tarjeta) return;
  tarjeta.scrollIntoView({ behavior: "smooth", block: "center" });
  tarjeta.classList.remove("resaltada");
  void tarjeta.offsetWidth;
  tarjeta.classList.add("resaltada");
});
hacerArrastrable(burbuja, burbuja, () => cambiarModo("abierto"));
$("#widgetMin").onclick = () => cambiarModo("burbuja");
$("#btnWidget").onclick = () => cambiarModo(estadoWidget.modo === "oculto" ? "abierto" : "oculto");
window.addEventListener("resize", () => colocar(widget.hidden ? burbuja : widget));

// ---------- Instalar como app ----------
let avisoInstalar = null;
const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const yaInstalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  avisoInstalar = e;
  $("#btnInstalar").hidden = false;
});
if (esIOS && !yaInstalada) $("#btnInstalar").hidden = false;

$("#btnInstalar").onclick = async () => {
  if (avisoInstalar) {
    avisoInstalar.prompt();
    await avisoInstalar.userChoice;
    avisoInstalar = null;
    $("#btnInstalar").hidden = true;
  } else if (esIOS) {
    $("#instruccionesIOS").showModal();
  }
};
$("#cerrarIOS").onclick = () => $("#instruccionesIOS").close();
window.addEventListener("appinstalled", () => { $("#btnInstalar").hidden = true; });

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---------- Inicio ----------
(async () => {
  papelPicado();
  window.addEventListener("resize", papelPicado);
  try {
    db = await abrirDB();
    await render();
  } catch {
    $("#vacio").hidden = false;
    $("#vacio p").textContent = "Este navegador no permite guardar datos (¿modo incógnito?).";
  }
  lluviaPetalos(12);
  setInterval(() => lluviaPetalos(3), 6000);
})();
