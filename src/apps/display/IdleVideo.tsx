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
  const { videos: library, reachable } = useVideoLibrary();
  const { getBoard } = useBoards();
  const todayStrokes = getBoard(dateKey(new Date()));
  const hasDrawing = todayStrokes.length > 0;
  const [slide, setSlide] = useState<Slide | null>(null);
  const clipsSinceSlide = useRef(0);
  const [playlist, setPlaylist] = useState(() => shuffledVideos(library));
  const [index, setIndex] = useState(0);
  // Bumped after a failure so the same file is fetched again, not reused.
  const [attempt, setAttempt] = useState(0);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const elements = useRef(new Map<string, HTMLVideoElement>());
  const seenLibrary = useRef(library);

  const current = playlist.length > 0 ? playlist[index % playlist.length] : undefined;
  // Load the next clip quietly underneath so the switch has no black gap.
  const next = playlist.length > 1 ? playlist[(index + 1) % playlist.length] : undefined;
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    if (seenLibrary.current === library) return;
    seenLibrary.current = library;
    setPlaylist(keepPlayingFirst(shuffledVideos(library), currentRef.current));
    setIndex(0);
  }, [library]);

  const failed = useCallback(() => {
    setConsecutiveErrors((count) => count + 1);
    setRetrying(true);
  }, []);

  // Wait longer after each failure in a row before trying the next clip.
  useEffect(() => {
    if (!retrying) return;
    const timer = window.setTimeout(() => {
      setRetrying(false);
      setAttempt((value) => value + 1);
      setIndex((value) => value + 1);
    }, videoRetryDelayMs(consecutiveErrors));
    return () => window.clearTimeout(timer);
  }, [consecutiveErrors, retrying]);

  // A clip that was preloaded underneath has to be started by hand, and a
  // single clip that finished before a slide has to start again.
  useEffect(() => {
    if (!current || retrying || slide) return;
    const element = elements.current.get(current);
    if (!element) return;
    if (element.error) {
      failed();
      return;
    }
    if (element.ended) element.currentTime = 0;
    if (element.paused) {
      void element.play().catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : "";
        // AbortError means the clip changed first. NotAllowedError is an
        // autoplay rule, not a broken file.
        if (name !== "AbortError" && name !== "NotAllowedError") failed();
      });
    }
  }, [attempt, current, failed, index, retrying, slide]);

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

  const clip = (url: string, role: "current" | "next") => (
    <video
      key={`${url}#${attempt}`}
      ref={(element) => {
        if (!element) return;
        elements.current.set(url, element);
        return () => {
          if (elements.current.get(url) === element) elements.current.delete(url);
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
        setConsecutiveErrors(0);
        setHasPlayed(true);
      }}
      onEnded={() => {
        if (currentRef.current === url) clipEnded();
      }}
      onError={() => {
        // A clip that fails while preloading is handled when its turn comes.
        if (currentRef.current === url) failed();
      }}
    />
  );

  return (
    <div className="display-media">
      <div className="display-gradient"><span>C</span></div>
      {/* The next clip comes first so that promoting it never moves it in the DOM. */}
      {next && next !== current && !retrying && clip(next, "next")}
      {current && !retrying && clip(current, "current")}
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
