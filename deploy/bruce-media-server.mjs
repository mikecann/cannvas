import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream";
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
  // Too late for a status once a reply has started (or the client has gone): just hang up.
  if (response.headersSent || response.destroyed) {
    response.destroy();
    return;
  }
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
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Number(range[2]) : end;
    } else {
      // "bytes=-500" is the last 500 bytes; players use it to find an MP4's index at the end.
      // "bytes=-" and "bytes=-0" ask for nothing, so they fall through to 416.
      const length = range[2] ? Number(range[2]) : 0;
      start = length > 0 ? Math.max(0, size - length) : -1;
    }
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
  // An empty file has nothing to stream (createReadStream rejects end -1), and a client that left
  // while we looked the file up can't be piped to.
  if (request.method === "HEAD" || size === 0 || response.destroyed) {
    response.end();
    return;
  }
  // pipe() leaves the file open when the wall drops a request part way (it skips and seeks videos
  // all day). Those leaked until the server hit macOS's 256 open-file limit. pipeline() closes it.
  pipeline(createReadStream(file, { start, end }), response, (error) => {
    if (error && error.code !== "ERR_STREAM_PREMATURE_CLOSE") console.error(`Cannvas media: ${file}: ${error.message}`);
  });
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
  const server = createMediaServer();
  // A client that vanishes without closing (the Pi dropping off Wi-Fi) would hold its file open
  // until TCP gives up. Hang up on any connection idle for five minutes instead.
  server.setTimeout(5 * 60 * 1000);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Cannvas media server listening on port ${port}, rooted at ${process.env.CANNVAS_MEDIA_ROOT ?? defaultRoot}`);
  });
}
