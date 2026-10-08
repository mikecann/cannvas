import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const defaultRoot = "/Volumes/CannMedia/CannvasVideoCache";
const defaultSourceRoot = "/Volumes/CannMedia/PhotoArchive";
// The Pi reaches Bruce as bruce.local. Loopback names let you curl it on Bruce.
const defaultAllowedHosts = ["bruce.local", "localhost", "127.0.0.1"];
const minimumTokenLength = 32;

const contentTypes = {
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export function isVideo(file) {
  return Object.hasOwn(contentTypes, extname(file).toLowerCase());
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sendError(response, status, message, headers = {}) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  response.end(`${message}\n`);
}

// The token lives in a mode-0600 file on Bruce, named by CANNVAS_MEDIA_TOKEN_FILE,
// so it stays out of the launchd plist, which is checked in.
export function loadToken(env = process.env) {
  if (env.CANNVAS_MEDIA_TOKEN) return env.CANNVAS_MEDIA_TOKEN.trim();
  if (env.CANNVAS_MEDIA_TOKEN_FILE) return readFileSync(env.CANNVAS_MEDIA_TOKEN_FILE, "utf8").trim();
  return "";
}

// Returns the lower-case host name from a Host header, without its port, or
// null when the header is missing or isn't a plain host name or address.
export function requestHostname(host = "") {
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.exec(host);
  return match ? match[1].toLowerCase().replace(/\.$/, "") : null;
}

function digest(value) {
  return createHash("sha256").update(value).digest();
}

// Comparing digests keeps the token's length and content out of the timing.
function hasToken(request, expected) {
  const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "");
  return match !== null && timingSafeEqual(digest(match[1]), expected);
}

async function serveDirectory(request, response, directory) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    // The cache contains real folders, browser-compatible video files, and
    // symlinks to browser-compatible originals. Photos and sidecars never
    // appear in this listing.
    .filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || isVideo(entry.name)))
    .sort((left, right) => left.name.localeCompare(right.name));
  const links = entries.map((entry) => {
    const suffix = entry.isDirectory() ? "/" : "";
    return `<li><a href="${encodeURIComponent(entry.name)}${suffix}">${escapeHtml(entry.name)}${suffix}</a></li>`;
  });
  const body = `<!doctype html><meta charset="utf-8"><title>Cannvas videos</title><ul>${links.join("")}</ul>`;
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

function serveFile(request, response, file, size) {
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = size - 1;
  let status = 200;

  if (range) {
    start = range[1] ? Number(range[1]) : 0;
    end = range[2] ? Number(range[2]) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
      response.writeHead(416, { "Content-Range": `bytes */${size}` });
      response.end();
      return;
    }
    end = Math.min(end, size - 1);
    status = 206;
  }

  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Type": contentTypes[extname(file).toLowerCase()],
    "Cache-Control": "private, max-age=3600",
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  response.writeHead(status, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file, { start, end }).pipe(response);
}

function isInside(parent, child) {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

export function createMediaServer({
  root = process.env.CANNVAS_MEDIA_ROOT ?? defaultRoot,
  sourceRoot = process.env.CANNVAS_MEDIA_SOURCE_ROOT ?? defaultSourceRoot,
  token = loadToken(),
  allowedHosts = defaultAllowedHosts,
} = {}) {
  if (typeof token !== "string" || token.length < minimumTokenLength) {
    throw new Error(`a token of at least ${minimumTokenLength} characters is required; set CANNVAS_MEDIA_TOKEN_FILE`);
  }
  const resolvedRoot = resolve(root);
  const resolvedSourceRoot = resolve(sourceRoot);
  const expectedToken = digest(token);
  const hosts = new Set(allowedHosts.map((host) => host.toLowerCase()));

  return createServer(async (request, response) => {
    // A web page could point a name it controls at Bruce (DNS rebinding) and
    // read the library through the visitor's browser. Only Bruce's own names
    // are answered.
    if (!hosts.has(requestHostname(request.headers.host))) {
      sendError(response, 403, "Forbidden");
      return;
    }
    // cannvas-server on the Pi adds the token when it proxies /videos, so
    // nothing else on the network can browse the family videos.
    if (!hasToken(request, expectedToken)) {
      sendError(response, 401, "Unauthorized", { "WWW-Authenticate": "Bearer" });
      return;
    }
    if (!request.url || !["GET", "HEAD"].includes(request.method ?? "")) {
      sendError(response, 405, "Method not allowed");
      return;
    }

    try {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      } catch {
        sendError(response, 400, "Bad request");
        return;
      }
      const target = resolve(resolvedRoot, pathname.replace(/^\/+/, ""));
      if (!isInside(resolvedRoot, target)) {
        sendError(response, 403, "Forbidden");
        return;
      }

      // H.264 originals are represented by symlinks in the generated cache.
      // Resolve them before serving and allow only the cache or PhotoArchive.
      const actualTarget = await realpath(target);
      const [actualRoot, actualSourceRoot] = await Promise.all([
        realpath(resolvedRoot),
        realpath(resolvedSourceRoot),
      ]);
      if (!isInside(actualRoot, actualTarget) && !isInside(actualSourceRoot, actualTarget)) {
        sendError(response, 403, "Forbidden");
        return;
      }

      const details = await stat(actualTarget);
      if (details.isDirectory()) await serveDirectory(request, response, target);
      else if (details.isFile() && isVideo(actualTarget)) serveFile(request, response, actualTarget, details.size);
      else sendError(response, 404, "Not found");
    } catch (error) {
      sendError(response, error?.code === "ENOENT" ? 404 : 500, error?.code === "ENOENT" ? "Not found" : "Media service error");
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.CANNVAS_MEDIA_PORT ?? 6113);
  // Set CANNVAS_MEDIA_HOST to the address the Pi connects to so the service
  // isn't offered on every interface. The default keeps the old behaviour.
  const host = process.env.CANNVAS_MEDIA_HOST || "0.0.0.0";
  const allowedHosts = process.env.CANNVAS_MEDIA_ALLOWED_HOSTS
    ? process.env.CANNVAS_MEDIA_ALLOWED_HOSTS.split(",").map((name) => name.trim()).filter(Boolean)
    : [...defaultAllowedHosts];
  const hostName = host.includes(":") ? `[${host}]` : host;
  if (host !== "0.0.0.0" && host !== "::" && !allowedHosts.includes(hostName)) allowedHosts.push(hostName);

  let server;
  try {
    server = createMediaServer({ allowedHosts });
  } catch (error) {
    console.error(`Cannvas media server not started: ${error.message}`);
    process.exit(1);
  }
  server.listen(port, host, () => {
    console.log(`Cannvas media server listening on ${host}:${port} for ${allowedHosts.join(", ")}, rooted at ${process.env.CANNVAS_MEDIA_ROOT ?? defaultRoot}`);
  });
}
