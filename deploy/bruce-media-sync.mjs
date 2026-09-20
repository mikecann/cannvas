import { realpathSync } from "node:fs";
import { lstat, mkdir, readdir, readlink, rename, stat, symlink, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(process.env.CANNVAS_MEDIA_SOURCE_ROOT ?? "/Volumes/CannMedia/PhotoArchive");
const cacheRoot = resolve(process.env.CANNVAS_MEDIA_ROOT ?? "/Volumes/CannMedia/CannvasVideoCache");
const maxConversions = Number(process.env.CANNVAS_MEDIA_MAX_CONVERSIONS ?? Number.POSITIVE_INFINITY);
const scanConcurrency = Math.max(1, Number(process.env.CANNVAS_MEDIA_SCAN_CONCURRENCY ?? 8));
const videoExtensions = new Set([".m4v", ".mov", ".mp4", ".webm"]);

export function isBrowserCompatibleCodec(codecs) {
  return /H\.264|AVC|VP8|VP9/i.test(codecs) && !/HEVC|H\.265/i.test(codecs);
}

export function isEligibleVideo({ durationSeconds, width, height }) {
  return Number.isFinite(durationSeconds)
    && durationSeconds >= 10
    && Number.isFinite(width)
    && Number.isFinite(height)
    && height > width;
}

export function cachePaths(source) {
  const relativeSource = relative(sourceRoot, source);
  return {
    direct: join(cacheRoot, relativeSource),
    converted: join(cacheRoot, `${relativeSource}.m4v`),
  };
}

async function* walkVideos(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walkVideos(path);
    else if (entry.isFile() && videoExtensions.has(extname(entry.name).toLowerCase())) yield path;
  }
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectRun);
    child.on("close", (code) => code === 0
      ? resolveRun({ stdout, stderr })
      : rejectRun(new Error(`${basename(command)} exited with ${code}`)));
  });
}

async function pathExists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function removeIfPresent(path) {
  if (await pathExists(path)) await unlink(path);
}

async function removeGeneratedArtifacts({ direct, converted }) {
  await removeIfPresent(direct);
  await removeIfPresent(converted);

  const directory = dirname(converted);
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const partialPrefix = `${basename(converted)}.partial-`;
  await Promise.all(entries
    .filter((name) => name.startsWith(partialPrefix))
    .map((name) => removeIfPresent(join(directory, name))));
}

async function hasCurrentConversion(source, converted) {
  const output = await pathExists(converted);
  if (!output?.isFile() || output.size === 0) return false;
  return output.mtimeMs >= (await stat(source)).mtimeMs;
}

async function hasCurrentDirectLink(source, direct) {
  const output = await pathExists(direct);
  if (!output?.isSymbolicLink()) return false;
  return resolve(dirname(direct), await readlink(direct)) === source;
}

function metadataNumber(output, key) {
  const match = output.match(new RegExp(`^${key}\\s*=\\s*([^\\n]+)$`, "m"));
  if (!match || match[1].trim() === "(null)") return Number.NaN;
  return Number(match[1].trim());
}

async function inspectMedia(source) {
  const { stdout } = await run("/usr/bin/mdls", [
    "-name", "kMDItemCodecs",
    "-name", "kMDItemDurationSeconds",
    "-name", "kMDItemPixelHeight",
    "-name", "kMDItemPixelWidth",
    source,
  ]);
  return {
    codecs: stdout.match(/kMDItemCodecs\s*=([\s\S]*?)(?=^kMDItem|$)/m)?.[1]?.trim() ?? "",
    durationSeconds: metadataNumber(stdout, "kMDItemDurationSeconds"),
    height: metadataNumber(stdout, "kMDItemPixelHeight"),
    width: metadataNumber(stdout, "kMDItemPixelWidth"),
  };
}

async function linkDirect(source, direct, converted) {
  await mkdir(dirname(direct), { recursive: true });
  await removeIfPresent(converted);
  if (await hasCurrentDirectLink(source, direct)) return;
  await removeIfPresent(direct);
  await symlink(source, direct);
}

async function convertVideo(source, direct, converted) {
  await mkdir(dirname(converted), { recursive: true });
  await removeIfPresent(direct);
  // Keep the temporary filename's media extension because avconvert selects
  // its output container from that suffix.
  const temporary = `${converted}.partial-${process.pid}.m4v`;
  await removeIfPresent(temporary);
  try {
    // Cannvas is a 1080p display. This preset produces H.264/AAC M4V files
    // that its Chromium build can play, while avoiding a pointless 4K cache.
    await run("/usr/bin/avconvert", [
      "--source", source,
      "--preset", "PresetAppleM4V1080pHD",
      "--output", temporary,
      "--replace",
    ]);
    await rename(temporary, converted);
  } finally {
    await removeIfPresent(temporary);
  }
}

export async function syncVideos() {
  await mkdir(cacheRoot, { recursive: true });
  const sources = [];
  for await (const source of walkVideos(sourceRoot)) sources.push(source);

  const pending = [];
  let direct = 0;
  let cached = 0;
  let inspected = 0;
  let excludedShort = 0;
  let excludedLandscape = 0;
  let excludedUnknown = 0;

  let nextSource = 0;
  async function inspectNext() {
    while (nextSource < sources.length) {
      const source = sources[nextSource];
      nextSource += 1;
      const paths = cachePaths(source);
      const media = await inspectMedia(source);
      inspected += 1;

      if (!isEligibleVideo(media)) {
        await removeGeneratedArtifacts(paths);
        if (!Number.isFinite(media.durationSeconds)
          || !Number.isFinite(media.width)
          || !Number.isFinite(media.height)) excludedUnknown += 1;
        else if (media.durationSeconds < 10) excludedShort += 1;
        else excludedLandscape += 1;
        continue;
      }

      if (await hasCurrentConversion(source, paths.converted)) {
        cached += 1;
        continue;
      }
      if (await hasCurrentDirectLink(source, paths.direct)) {
        direct += 1;
        continue;
      }

      if (isBrowserCompatibleCodec(media.codecs)) {
        await linkDirect(source, paths.direct, paths.converted);
        direct += 1;
      } else {
        pending.push({ source, ...paths });
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(scanConcurrency, sources.length) },
    () => inspectNext(),
  ));

  console.log(`Cannvas media scan complete: ${direct} direct, ${cached} cached, ${pending.length} conversions pending, ${excludedShort} short excluded, ${excludedLandscape} landscape excluded, ${excludedUnknown} unknown excluded, ${inspected} inspected`);

  let converted = 0;
  let failed = 0;
  for (const item of pending) {
    if (converted >= maxConversions) break;
    try {
      await convertVideo(item.source, item.direct, item.converted);
      converted += 1;
      if (converted % 25 === 0) console.log(`Cannvas media conversion progress: ${converted}/${pending.length}`);
    } catch {
      failed += 1;
    }
  }

  console.log(`Cannvas media sync finished: ${converted} converted, ${failed} failed, ${Math.max(0, pending.length - converted - failed)} remaining`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncVideos();
}
