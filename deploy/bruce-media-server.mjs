import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve("/Volumes/CannMedia/bak/Josh Google Photos/Just Webm");
const port = 6113;

const contentTypes = {
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

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
    .filter((entry) => !entry.name.startsWith("."))
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
    "Content-Type": contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
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

createServer(async (request, response) => {
  if (!request.url || !["GET", "HEAD"].includes(request.method ?? "")) {
    sendError(response, 405, "Method not allowed");
    return;
  }

  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const target = resolve(root, pathname.replace(/^\/+/, ""));
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      sendError(response, 403, "Forbidden");
      return;
    }
    const details = await stat(target);
    if (details.isDirectory()) await serveDirectory(request, response, target);
    else if (details.isFile()) serveFile(request, response, target, details.size);
    else sendError(response, 404, "Not found");
  } catch (error) {
    sendError(response, error?.code === "ENOENT" ? 404 : 500, error?.code === "ENOENT" ? "Not found" : "Media service error");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Cannvas media server listening on port ${port}, rooted at ${root}`);
});
