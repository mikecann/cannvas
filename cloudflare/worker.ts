export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    // The public domain is a curated app launcher. The full dashboard remains
    // available only on the physical Cannvas display.
    if (url.pathname === "/" || url.pathname === "/index.html") {
      url.pathname = "/apps/index.html";
      return env.ASSETS.fetch(new Request(url, request));
    }

    if (url.pathname === "/inventory" || url.pathname === "/inventory/") {
      url.pathname = "/inventory/index.html";
      return env.ASSETS.fetch(new Request(url, request));
    }

    if (url.pathname === "/giveaway" || url.pathname === "/giveaway/") {
      url.pathname = "/giveaway/index.html";
      return env.ASSETS.fetch(new Request(url, request));
    }

    if (
      url.pathname.startsWith("/inventory/") ||
      url.pathname.startsWith("/giveaway/") ||
      url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/avatars/")
    ) {
      return env.ASSETS.fetch(request);
    }

    return Response.redirect(new URL("/", request.url), 302);
  },
} satisfies ExportedHandler<Env>;
