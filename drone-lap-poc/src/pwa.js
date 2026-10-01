// Production only: a service worker in dev would serve stale modules.
export function registerServiceWorker() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
