/* Keeps a copy of the app on the device so it opens without internet.
   Bump VERSION whenever any app file changes. */
const VERSION = 'casedesk-v6';
const FILES = ['./', 'index.html', 'shim.js', 'jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js', 'jszip.min.js', 'extras.js',
  'ocr/tesseract.min.js', 'ocr/worker.min.js', 'ocr/tesseract-core-simd-lstm.wasm.js', 'ocr/tesseract-core-lstm.wasm.js', 'ocr/eng.traineddata.gz',
  'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
