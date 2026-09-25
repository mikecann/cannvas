import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const defaultRoot = "/Volumes/CannMedia/CannvasVideoCache";
const defaultSourceRoot = "/Volumes/CannMedia/PhotoArchive";

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

function sendError(response, status, message) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(`${message}\n`);
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
} = {}) {
  const resolvedRoot = resolve(root);
  const resolvedSourceRoot = resolve(sourceRoot);

  return createServer(async (request, response) => {
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
  createMediaServer().listen(port, "0.0.0.0", () => {
    console.log(`Cannvas media server listening on port ${port}, rooted at ${process.env.CANNVAS_MEDIA_ROOT ?? defaultRoot}`);
  });
}
