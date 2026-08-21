const CACHE_NAME = 'entrevistas-ontivero-v3';
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json',
    '/logo-iaesen.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// IMPORTANTE: El Service Worker NO debe interceptar el audio ni la voz
self.addEventListener('fetch', event => {
    // Solo cachear archivos estáticos. Ignorar todo lo demás (audio, API, etc.)
    if (event.request.url.includes('/api/') || event.request.url.includes('.mp3') || event.request.url.includes('.webm')) {
        return; // No interceptar API, audio ni voz
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});