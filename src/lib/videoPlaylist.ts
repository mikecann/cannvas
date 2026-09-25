export function shuffledVideos<T>(items: readonly T[], random = Math.random): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

// The mirror proxies Bruce's private media service so the browser only needs
// access to the same loopback origin as the rest of Cannvas.
export const VIDEO_ROOT = "/videos/";
const LINK_PATTERN = /<a href="([^"]+)"/g;
const VIDEO_FILE = /\.(mp4|m4v|mov|webm)$/i;

/** Split one directory listing page into video files and sub-folders. */
export function parseVideoListing(html: string, folder: string, origin: string) {
  const urls = [...html.matchAll(LINK_PATTERN)]
    .map((match) => match[1])
    .filter((href) => href !== "../" && href !== "./../")
    // Keep proxy URLs relative to Cannvas. `new URL(href, root)` turns them
    // into absolute browser URLs, which then fail the VIDEO_ROOT safety check.
    .map((href) => new URL(href, new URL(folder, origin)))
    // A link to another host is not one of Bruce's files, whatever its path.
    .filter((url) => url.origin === new URL(origin).origin && url.pathname.startsWith(VIDEO_ROOT))
    .map((url) => url.pathname);
  return {
    videos: urls.filter((url) => VIDEO_FILE.test(url)),
    folders: urls.filter((url) => url.endsWith("/") && url !== folder),
  };
}

/** After this many failed clips in a row, say so on screen. */
export const VIDEO_OFFLINE_AFTER_ERRORS = 3;
const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;

/**
 * How long to wait before trying the next clip after `consecutiveErrors`
 * failures in a row. Doubles from 2 seconds up to a minute, so an offline
 * video server isn't asked for a new clip many times a second.
 */
export function videoRetryDelayMs(consecutiveErrors: number) {
  if (consecutiveErrors <= 0) return 0;
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (consecutiveErrors - 1));
}

/**
 * Put `playing` first in a fresh list, so a new listing doesn't cut off the
 * clip that is already on screen.
 */
export function keepPlayingFirst(videos: readonly string[], playing: string | undefined) {
  if (!playing || !videos.includes(playing)) return [...videos];
  return [playing, ...videos.filter((video) => video !== playing)];
}
