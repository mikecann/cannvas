const isInventoryRoute = /^\/inventory(?:\/|$)/.test(window.location.pathname);
const isGiveawayRoute = /^\/giveaway(?:\/|$)/.test(window.location.pathname);

// Convex static hosting uses the root HTML as its SPA fallback. Route here so
// the standalone mobile pages still boot without changing their public URLs.
if (isInventoryRoute) {
  void import("./inventory/main");
} else if (isGiveawayRoute) {
  void import("./giveaway/main");
} else {
  void import("./kioskMain");
}
