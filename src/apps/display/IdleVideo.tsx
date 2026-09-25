import { CloudOff, Film, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBoards } from "../../data/DataProvider";
import type { Stroke } from "../../data/types";
import { dateKey } from "../../lib/dates";
import { keepPlayingFirst, shuffledVideos, VIDEO_OFFLINE_AFTER_ERRORS, videoRetryDelayMs } from "../../lib/videoPlaylist";
import { useVideoLibrary } from "./useVideoLibrary";
import { WhiteboardSlide } from "./WhiteboardSlide";

// Today's drawing shows for a while after every few clips.
const SLIDE_EVERY_CLIPS = 3;
const SLIDE_MS = 10_000;
// Without videos, show the drawing once a minute over the gradient instead.
const SLIDE_WITHOUT_VIDEO_EVERY_MS = 60_000;
// A clip that hasn't started playing after this long counts as failed.
const CLIP_START_TIMEOUT_MS = 30_000;

type Slide = { strokes: Stroke[]; thenNextClip: boolean };

type IdleVideoProps = {
  muted: boolean;
  /** Tells the home screen whether there is a clip to unmute. */
  onPlayableChange: (playable: boolean) => void;
};

type Notice = { kind: "loading" | "offline" | "empty"; title: string; detail?: string };

// Plays Bruce's family videos behind the home screen. The gradient always
// sits underneath, so a gap between clips or a missing server never shows a
// grey or black screen.
export function IdleVideo({ muted, onPlayableChange }: IdleVideoProps) {
  const { videos: library, reachable, checkedAt } = useVideoLibrary();
  const { getBoard } = useBoards();
  const todayStrokes = getBoard(dateKey(new Date()));
  const hasDrawing = todayStrokes.length > 0;
  const [slide, setSlide] = useState<Slide | null>(null);
  const clipsSinceSlide = useRef(0);
  const [playlist, setPlaylist] = useState(() => shuffledVideos(library));
  const [index, setIndex] = useState(0);
  // How often each clip has failed. It is part of the element key, so a
  // retry fetches the file again while other clips keep their elements.
  const [retries, setRetries] = useState<Record<string, number>>({});
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  // The clip waiting out its backoff, if any.
  const [retrying, setRetrying] = useState<string | null>(null);
  const [hasPlayed, setHasPlayed] = useState(false);
  const elements = useRef(new Map<string, HTMLVideoElement>());
  const failedKeys = useRef(new Set<string>());
  const startedKey = useRef<string | null>(null);
  const seenLibrary = useRef(library);

  const keyFor = (url: string) => `${url}#${retries[url] ?? 0}`;
  const current = playlist.length > 0 ? playlist[index % playlist.length] : undefined;
  // Load the next clip quietly underneath so the switch has no black gap.
  const next = playlist.length > 1 ? playlist[(index + 1) % playlist.length] : undefined;
  const currentKey = current ? keyFor(current) : null;
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    if (seenLibrary.current === library) return;
    seenLibrary.current = library;
    setPlaylist(keepPlayingFirst(shuffledVideos(library), currentRef.current));
    setIndex(0);
  }, [library]);

  // play() rejecting and the error event can both report one broken load, so
  // count each element's failure once.
  const failed = useCallback((url: string, key: string) => {
    if (failedKeys.current.has(key)) return;
    failedKeys.current.add(key);
    setConsecutiveErrors((count) => count + 1);
    setRetrying(url);
  }, []);

  // Wait longer after each failure in a row before trying the next clip.
  useEffect(() => {
    if (!retrying) return;
    const timer = window.setTimeout(() => {
      setRetries((counts) => ({ ...counts, [retrying]: (counts[retrying] ?? 0) + 1 }));
      setRetrying(null);
      setIndex((value) => value + 1);
    }, videoRetryDelayMs(consecutiveErrors));
    return () => window.clearTimeout(timer);
  }, [consecutiveErrors, retrying]);

  // Bruce answering the listing again clears the offline message and cuts
  // the current backoff short (a zero error count means no wait).
  useEffect(() => {
    if (reachable) setConsecutiveErrors((count) => (count >= VIDEO_OFFLINE_AFTER_ERRORS ? 0 : count));
  }, [checkedAt, reachable]);

  // A clip that was preloaded underneath has to be started by hand, and a
  // single clip that finished before a slide has to start again.
  useEffect(() => {
    if (!current || !currentKey || retrying || slide) return;
    const element = elements.current.get(currentKey);
    if (!element) return;
    if (element.error) {
      failed(current, currentKey);
      return;
    }
    if (element.ended) element.currentTime = 0;
    if (element.paused) {
      void element.play().catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : "";
        // AbortError means the clip changed first. NotAllowedError is an
        // autoplay rule, not a broken file; the load timeout below covers it.
        if (name !== "AbortError" && name !== "NotAllowedError") failed(current, currentKey);
      });
    }
  }, [current, currentKey, failed, index, retrying, slide]);

  // A load that stalls without an error counts as a failure after a while,
  // so "Loading the family videos…" can't stay up forever.
  useEffect(() => {
    if (!current || !currentKey || retrying || slide || startedKey.current === currentKey) return;
    const timer = window.setTimeout(() => {
      if (startedKey.current !== currentKey) failed(current, currentKey);
    }, CLIP_START_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [current, currentKey, failed, retrying, slide]);

  const clipEnded = () => {
    clipsSinceSlide.current += 1;
    if (hasDrawing && clipsSinceSlide.current >= SLIDE_EVERY_CLIPS) {
      clipsSinceSlide.current = 0;
      setSlide({ strokes: todayStrokes, thenNextClip: true });
    } else {
      setIndex((value) => value + 1);
    }
  };

  useEffect(() => {
    if (!slide) return;
    const timer = window.setTimeout(() => {
      setSlide(null);
      if (slide.thenNextClip) setIndex((value) => value + 1);
    }, SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [slide]);

  const offline = consecutiveErrors >= VIDEO_OFFLINE_AFTER_ERRORS || (reachable === false && playlist.length === 0);
  const playable = Boolean(current) && !offline;
  useEffect(() => onPlayableChange(playable), [onPlayableChange, playable]);

  const latestStrokes = useRef(todayStrokes);
  latestStrokes.current = todayStrokes;
  useEffect(() => {
    if (playable || !hasDrawing) return;
    const timer = window.setInterval(() => {
      setSlide((currentSlide) => currentSlide ?? { strokes: latestStrokes.current, thenNextClip: false });
    }, SLIDE_WITHOUT_VIDEO_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [hasDrawing, playable]);

  const notice: Notice | null = offline
    ? {
        kind: "offline",
        title: "Can't reach the videos on Bruce",
        detail: "Bruce might be asleep or off the network. Cannvas will keep trying in the background.",
      }
    : reachable === true && playlist.length === 0
      ? { kind: "empty", title: "No videos on Bruce yet", detail: "Add some to the shared folder and they'll start playing here." }
      : !hasPlayed
        ? { kind: "loading", title: "Loading the family videos…" }
        : null;

  const clip = (url: string, role: "current" | "next") => {
    const key = keyFor(url);
    return (
      <video
        key={key}
        ref={(element) => {
          if (!element) return;
          elements.current.set(key, element);
          return () => {
            if (elements.current.get(key) === element) elements.current.delete(key);
          };
        }}
        className={role === "next" ? "is-next" : undefined}
        src={url}
        autoPlay={role === "current"}
        preload="auto"
        muted={role === "current" ? muted : true}
        loop={role === "current" && playlist.length === 1 && !hasDrawing}
        playsInline
        onLoadedData={(event) => { event.currentTarget.dataset.ready = "true"; }}
        onPlaying={() => {
          if (currentRef.current !== url) return;
          startedKey.current = key;
          setConsecutiveErrors(0);
          setHasPlayed(true);
        }}
        onEnded={() => {
          if (currentRef.current === url) clipEnded();
        }}
        onError={() => {
          // A clip that fails while preloading is handled when its turn comes.
          if (currentRef.current === url) failed(url, key);
        }}
      />
    );
  };

  return (
    <div className="display-media">
      <div className="display-gradient"><span>C</span></div>
      {/* The next clip comes first so that promoting it never moves it in the
          DOM, and it stays loaded while a failed clip waits out its backoff. */}
      {next && next !== current && next !== retrying && clip(next, "next")}
      {current && current !== retrying && clip(current, "current")}
      {notice && (
        <div className={`display-video-notice ${notice.kind}`} role="status">
          {notice.kind === "loading" ? <LoaderCircle className="spin" /> : notice.kind === "offline" ? <CloudOff /> : <Film />}
          <span>
            <strong>{notice.title}</strong>
            {notice.detail && <small>{notice.detail}</small>}
          </span>
        </div>
      )}
      {slide && <WhiteboardSlide strokes={slide.strokes} />}
    </div>
  );
}
