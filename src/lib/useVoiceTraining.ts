import { useCallback, useEffect, useState } from "react";
import { errorText, readJsonResponse } from "./http";
import { parseVoiceEvent, parseVoiceSample, type TrainingChoice, type TrainingState, type VoiceSample } from "./voice";

async function post(path: string, body: unknown = {}) {
  await readJsonResponse(
    await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    "Voice commands didn't answer",
  );
}

/**
 * Record people saying the wake word around the room. The Pi scores each try
 * with the live model and acts on none of them. Leaving the page stops the
 * recording, so the room is never recorded by accident.
 */
export function useVoiceTraining() {
  const [training, setTraining] = useState<TrainingState>({ active: false });
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/voice/training", { signal: controller.signal })
      .then((response) => readJsonResponse<{ samples?: unknown[] }>(response, "Voice commands aren't running"))
      .then((body) => setSamples((body.samples ?? []).map(parseVoiceSample).filter((sample) => sample !== null)))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorText(reason, "Voice commands aren't running"));
      });

    const source = new EventSource("/api/voice/events");
    source.onmessage = (message) => {
      const event = parseVoiceEvent(message.data);
      if (event?.type === "training") {
        setTraining(event.active
          ? { active: true, endsAt: event.endsAt, speaker: event.speaker, spot: event.spot, saying: event.saying }
          : { active: false });
      } else if (event?.type === "sample") {
        setSamples((previous) => [event.sample, ...previous.filter(({ id }) => id !== event.sample.id)]);
      }
    };
    return () => {
      controller.abort();
      source.close();
      void post("/api/voice/training/stop").catch(() => undefined);
    };
  }, []);

  const run = useCallback(async (task: Promise<void>) => {
    try {
      await task;
      setError("");
    } catch (reason) {
      setError(errorText(reason, "Voice commands didn't answer"));
    }
  }, []);

  const start = useCallback((choice: TrainingChoice) => run(post("/api/voice/training/start", choice)), [run]);
  const stop = useCallback(() => run(post("/api/voice/training/stop")), [run]);
  const remove = useCallback((id: string) => run(post("/api/voice/training/delete", { id }).then(() => {
    setSamples((previous) => previous.filter((sample) => sample.id !== id));
  })), [run]);

  return { training, samples, error, start, stop, remove };
}
