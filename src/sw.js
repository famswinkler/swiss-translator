/* sw.js – service worker. Three jobs:
 * 1. Cache the app files (and the ONNX runtime in lib/) so the app opens offline.
 * 2. Add "cross-origin isolation" headers to our own pages. GitHub Pages cannot set
 *    headers, but this lets the AI engine use several CPU cores (SharedArrayBuffer).
 * 3. Leave model downloads alone: transformers.js stores them itself in the Cache API
 *    ("transformers-cache"), so they also work offline after the first download.
 */
const CACHE = 'sermon-translator-v4';
const SHELL = ['./', './index.html', './app.js', './vad.js', './models.js', './worker.js', './cloud.js', './truecase.js', './audio-worklet.js',
  './styles.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './lib/transformers.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sermon-translator-') && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

function withIsolation(resp) {
  if (!resp || resp.status === 0 || resp.type === 'opaque') return resp;
  const h = new Headers(resp.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;   // models etc.: browser default
  const isolate = !url.searchParams.has('noisolate');
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let resp;
    if (url.pathname.includes('/lib/')) {
      // Big runtime files: cache-first (they never change for a given version)
      resp = await cache.match(req, { ignoreSearch: true });
      if (!resp) { resp = await fetch(req); if (resp.ok) cache.put(req, resp.clone()); }
    } else {
      // App files: network-first so updates arrive, cache when offline
      try { resp = await fetch(req); if (resp.ok) cache.put(req, resp.clone()); }
      catch (err) { resp = await cache.match(req, { ignoreSearch: true }); }
    }
    return isolate ? withIsolation(resp) : resp;
  })());
});
