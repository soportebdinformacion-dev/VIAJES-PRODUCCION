/* =====================================================================
   SERVICE WORKER – Registro de Salidas & Retornos (Agrícola Huarmey)
   Permite abrir la aplicación sin internet.
   IMPORTANTE: cada vez que modifique index.html, cambie el número de
   VERSION (por ejemplo 'v2') para que los teléfonos descarguen la
   versión nueva.
   ===================================================================== */
const VERSION = 'v5';
const CACHE = 'huarmey-packing-' + VERSION;
const RECURSOS = [
  './',
  './index.html',
  './manifest.json',
  './membrete.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// Instalación: guarda los archivos de la aplicación (uno a uno, tolera fallos aislados)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(RECURSOS.map(url => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

// Activación: elimina versiones antiguas del almacenamiento
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k.startsWith('huarmey-packing-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Solo se gestionan los archivos propios. Las llamadas a Google Apps Script NO se guardan.
  if (url.origin !== self.location.origin) return;

  // Páginas: primero la red (versión más reciente); sin internet, la copia guardada.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(resp => {
        const copia = resp.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copia));
        return resp;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Imágenes, iconos, manifest: copia guardada y actualización en segundo plano.
  event.respondWith(
    caches.match(req).then(enCache => {
      const red = fetch(req).then(resp => {
        if (resp && resp.ok) { const copia = resp.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
        return resp;
      }).catch(() => enCache);
      return enCache || red;
    })
  );
});
