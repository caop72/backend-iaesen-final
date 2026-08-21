const CACHE_NAME = 'iaesen-v4';
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
                    return null;
                })
            );
        })
    );
    self.clients.claim();
});

// 🔴 CRÍTICO: NUNCA cachear APIs ni métodos POST/PUT/DELETE
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const esAPI = url.pathname.startsWith('/api/');
    const esPOST = event.request.method !== 'GET';

    if (esAPI || esPOST) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Cache-first SOLO para assets estáticos (HTML, CSS, JS, MP3)
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});