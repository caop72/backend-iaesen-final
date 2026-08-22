// ============================================================
// SERVICE WORKER CORREGIDO - v5
// ============================================================
const CACHE_NAME = 'iaesen-v5';
const STATIC_ASSETS = [
    './',
    './index.html',
    './app.js',
    './manifest.json',
    './logo-iaesen.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        Promise.all([
            caches.keys().then(keys => {
                return Promise.all(
                    keys.filter(key => key !== CACHE_NAME)
                        .map(key => caches.delete(key))
                );
            }),
            self.clients.claim()
        ])
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    
    if (url.origin === 'https://backend-iaesen-final.onrender.com' && 
        url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(request));
        return;
    }
    
    if (request.method !== 'GET') {
        event.respondWith(fetch(request));
        return;
    }
    
    if (STATIC_ASSETS.includes(url.pathname) || 
        STATIC_ASSETS.includes('./' + url.pathname)) {
        event.respondWith(
            caches.match(request)
                .then(cached => cached || fetch(request))
                .catch(() => caches.match('./index.html'))
        );
        return;
    }
    
    event.respondWith(
        fetch(request)
            .then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, clone);
                    });
                }
                return response;
            })
            .catch(() => caches.match(request))
    );
});