import { useState } from "react";
import { usePolling } from "../../lib/usePolling";
import { parseVideoListing, VIDEO_ROOT } from "../../lib/videoPlaylist";

const VIDEO_CACHE_KEY = "cannvas-video-list-v5";
// Bruce's library changes rarely. Check it every half hour, not every time
// the home screen opens.
const RECRAWL_MS = 30 * 60_000;
// While Bruce can't be reached, look again every minute. The Pi answers
// straight away while Bruce is down, so this costs nothing.
const UNREACHABLE_RETRY_MS = 60_000;

export type VideoLibrary = {
  videos: string[];
  /** null until the first listing attempt in this page load finishes. */
  reachable: boolean | null;
  checkedAt: number;
};

function readCache(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(VIDEO_CACHE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.startsWith(VIDEO_ROOT)) : [];
  } catch {
    return [];
  }
}

function writeCache(videos: string[]) {
  try {
    localStorage.setItem(VIDEO_CACHE_KEY, JSON.stringify(videos));
  } catch {
    // The cache only speeds up the next start.
  }
}

async function crawlVideos(root = VIDEO_ROOT, depth = 0, visited = new Set<string>()): Promise<string[]> {
  if (depth > 10 || visited.has(root)) return [];
  visited.add(root);
  const response = await fetch(root);
  if (!response.ok) throw new Error(`Video server returned ${response.status}`);
  const { videos, folders } = parseVideoListing(await response.text(), root, window.location.origin);
  const nested = await Promise.all(folders.map((folder) => crawlVideos(folder, depth + 1, visited)));
  return [...videos, ...nested.flat()];
}

// Shared by every visit to the home screen in this page load.
let library: VideoLibrary = { videos: readCache(), reachable: null, checkedAt: 0 };

function nextCheckIn(current: VideoLibrary) {
  return current.reachable === false || current.videos.length === 0 ? UNREACHABLE_RETRY_MS : RECRAWL_MS;
}

export function useVideoLibrary(): VideoLibrary {
  const [snapshot, setSnapshot] = useState(library);

  usePolling(async () => {
    const age = Date.now() - library.checkedAt;
    const wait = nextCheckIn(library);
    if (library.checkedAt > 0 && age < wait) {
      setSnapshot(library);
      return wait - age;
    }
    try {
      const found = await crawlVideos();
      // An empty listing is more likely a share that hasn't mounted than a
      // library that was emptied, so keep the last good list in that case.
      const videos = found.length > 0 ? found : library.videos;
      if (found.length > 0) writeCache(found);
      library = { videos, reachable: true, checkedAt: Date.now() };
    } catch {
      library = { ...library, reachable: false, checkedAt: Date.now() };
    }
    setSnapshot(library);
    return nextCheckIn(library);
  }, RECRAWL_MS);

  return snapshot;
}
