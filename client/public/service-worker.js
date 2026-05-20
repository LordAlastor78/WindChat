/**
 * WindChat Service Worker
 * 
 * Responsabilidades:
 * - Caché de assets estáticos (HTML, CSS, JS)
 * - Estrategia: Network First con fallback a cache
 * - Soporte offline básico
 */

const CACHE_NAME = 'windchat-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/chat.html',
];

// Instalación: cachear assets estáticos
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Cacheando assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[SW] Assets cacheados correctamente');
        return self.skipWaiting(); // Activar inmediatamente
      })
      .catch((err) => {
        console.error('[SW] Error al cachear assets:', err);
      })
  );
});

// Activación: limpiar cachés antiguos
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando service worker...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Eliminando caché antiguo:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activado');
        return self.clients.claim(); // Controlar todas las páginas inmediatamente
      })
  );
});

// Fetch: Network First con fallback a cache
self.addEventListener('fetch', (event) => {
  // Solo cachear GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // No cachear WebSocket connections
  if (event.request.url.includes('ws://') || event.request.url.includes('wss://')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Validar respuesta antes de cachear
        try {
          // Cachear sólo respuestas OK
          if (!response || response.status !== 200) return response;

          // Evitar cachear respuestas opaques (cross-origin without CORS)
          if (response.type === 'opaque') return response;

          // Sólo cachear recursos con Content-Type permitidos
          const contentType = response.headers.get('Content-Type') || '';
          const allowed = [
            'text/html',
            'text/css',
            'application/javascript',
            'application/json',
            'image/',
          ];

          const isAllowed = allowed.some((t) => contentType.startsWith(t));
          if (!isAllowed) return response;

          // Sólo cachear same-origin or CORS responses
          if (response.type !== 'basic' && response.type !== 'cors') return response;

          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });

          return response;
        } catch (err) {
          console.warn('[SW] No se cacheó la respuesta por validación:', err);
          return response;
        }
      })
      .catch(() => {
        // Si falla la red, intentar obtener del cache
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              console.log('[SW] Sirviendo desde caché:', event.request.url);
              return cachedResponse;
            }

            // Si no está en caché y es navegación, retornar página offline
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }

            // Para otros recursos, retornar error genérico
            return new Response('Offline - recurso no disponible', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({ 'Content-Type': 'text/plain' })
            });
          });
      })
  );
});

// Message: comunicación con el cliente
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
