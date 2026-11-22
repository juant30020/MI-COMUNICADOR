/* Service worker de "Mi Comunicador"
   - Guarda la app para abrirla sin internet.
   - Si cambias la app y quieres que todos reciban la versión nueva, sube el número de VERSION. */
const VERSION   = "v1";
const APP_CACHE = "mi-comunicador-app-" + VERSION;
const FUENTES   = "mi-comunicador-fuentes";
const NUCLEO = ["./", "./index.html", "./manifest.webmanifest",
                "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png", "./favicon.png"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(APP_CACHE);
    await Promise.all(NUCLEO.map(u => c.add(new Request(u, {cache:"reload"})).catch(()=>{})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves
      .filter(k => k.startsWith("mi-comunicador-app-") && k !== APP_CACHE)
      .map(k => caches.delete(k)));          /* las fotos y videos NO se borran: viven en otra caché */
    await self.clients.claim();
  })());
});

/* El video pide "trozos" (Range). La caché devuelve el archivo completo, así que lo cortamos aquí. */
async function responderRango(req, resp) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  if (!m) return resp;
  const blob = await resp.blob();
  const total = blob.size;
  let ini = m[1] ? parseInt(m[1], 10) : 0;
  let fin = m[2] ? parseInt(m[2], 10) : total - 1;
  if (!m[1] && m[2]) { ini = Math.max(0, total - parseInt(m[2], 10)); fin = total - 1; }
  fin = Math.min(fin, total - 1);
  if (ini > fin || ini >= total) {
    return new Response(null, {status: 416, headers: {"Content-Range": "bytes */" + total}});
  }
  return new Response(blob.slice(ini, fin + 1), {
    status: 206, statusText: "Partial Content",
    headers: {
      "Content-Type": resp.headers.get("Content-Type") || blob.type || "video/mp4",
      "Content-Range": "bytes " + ini + "-" + fin + "/" + total,
      "Content-Length": String(fin - ini + 1),
      "Accept-Ranges": "bytes"
    }
  });
}

/* Páginas: primero internet (para recibir cambios), y si no hay, la copia guardada. */
async function navegar(req) {
  const c = await caches.open(APP_CACHE);
  try {
    const r = await Promise.race([
      fetch(req, {cache: "no-cache"}),
      new Promise((_, no) => setTimeout(() => no(new Error("lento")), 4000))
    ]);
    if (r && r.ok) { c.put("./index.html", r.clone()); return r; }
  } catch (_) {}
  return (await c.match("./index.html", {ignoreSearch: true})) ||
         (await c.match("./", {ignoreSearch: true})) ||
         new Response("Sin conexión", {status: 503});
}

async function guardadoPrimero(req, cacheNombre) {
  const hit = await caches.match(req, {ignoreVary: true, ignoreSearch: true});
  if (hit) return req.headers.get("range") ? responderRango(req, hit) : hit;
  try {
    const r = await fetch(req);
    if (cacheNombre && r && (r.ok || r.type === "opaque") && r.status !== 206) {
      const c = await caches.open(cacheNombre); c.put(req, r.clone());
    }
    return r;
  } catch (err) {
    return Response.error();
  }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") { e.respondWith(navegar(req)); return; }
    e.respondWith(guardadoPrimero(req, null));
    return;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(guardadoPrimero(req, FUENTES));
  }
});
