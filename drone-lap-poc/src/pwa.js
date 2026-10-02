// Production only: a service worker in dev would serve stale modules.
// VITE_NO_SW: the PoC is deployed under v1 at /poc/ and must not register its SW there.
export function registerServiceWorker() {
  if (import.meta.env.PROD && !import.meta.env.VITE_NO_SW && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
