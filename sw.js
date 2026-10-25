// Service Worker: hält die App-Dateien auf dem Gerät, damit sie offline funktioniert.
// Dokumente werden hier nie gespeichert – sie existieren nur im Arbeitsspeicher der Seite.
const VERSION = 'v3';
const CACHE = `pdf-redact-${VERSION}`;
const APP_FILES = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-512.png',
  'js/app.js', 'js/detect.js', 'js/data.js', 'js/pseudo.js', 'js/pdfmodel.js', 'js/redact.js', 'js/viewer.js', 'js/structure.js', 'js/templates.js',
  'vendor/pdf-lib/pdf-lib.min.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pdf-redact-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Erst Netz (für Updates), sonst Gerätespeicher – so läuft die App auch offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
