import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE_VOICE, parseVoiceEvent, type VoiceState } from "./voice";

export type VoiceHandlers = {
  /** The wake word was heard or the mic button pressed. */
  onWake: () => void;
  onOpenApp: (app: string) => void;
};

/**
 * Follow the Pi's voice service. Returns what it is doing, the microphone
 * level while it listens, and functions to start listening without the wake
 * word or to stop a reply. When the service isn't running this stays idle and quietly
 * reconnects.
 */
export function useVoice(handlers: VoiceHandlers) {
  const [state, setState] = useState<VoiceState>(IDLE_VOICE);
  const [level, setLevel] = useState(0);
  const handlersRef = useRef(handlers);
  const phaseRef = useRef(IDLE_VOICE.phase);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const source = new EventSource("/api/voice/events");
    source.onmessage = (message) => {
      const event = parseVoiceEvent(message.data);
      if (!event) return;
      if (event.type === "level") {
        setLevel(event.value);
      } else if (event.type === "command") {
        handlersRef.current.onOpenApp(event.app);
      } else {
        if (event.phase === "listening" && phaseRef.current !== "listening") handlersRef.current.onWake();
        phaseRef.current = event.phase;
        setState({ phase: event.phase, heard: event.heard, reply: event.reply });
        if (event.phase !== "listening") setLevel(0);
      }
    };
    return () => source.close();
  }, []);

  const listen = useCallback(() => {
    void fetch("/api/voice/listen", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
  }, []);

  const cancel = useCallback(() => {
    void fetch("/api/voice/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
  }, []);

  return { ...state, level, listen, cancel };
}
