const isInventoryRoute = /^\/inventory(?:\/|$)/.test(window.location.pathname);

// Convex static hosting uses the root HTML as its SPA fallback. Route here so
// /inventory still boots the mobile app without changing the public URL.
void import(isInventoryRoute ? "./inventory/main" : "./kioskMain");
