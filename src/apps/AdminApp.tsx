import { useMemo, useState } from "react";
import { Check, Mic, SlidersHorizontal, Square, Trash2, TriangleAlert, X } from "lucide-react";
import { useVoiceTraining } from "../lib/useVoiceTraining";
import { trainingTally, type TrainingChoice, type VoiceSample } from "../lib/voice";

type Option<T extends string> = { id: T; label: string; hint?: string };

const SPEAKERS: Option<string>[] = [
  { id: "mike", label: "Mike" },
  { id: "kelsie", label: "Kelsie" },
  { id: "josh", label: "Josh" },
  { id: "guest", label: "Someone else" },
];

const SPOTS: Option<string>[] = [
  { id: "close", label: "By the screen", hint: "Under 1 m" },
  { id: "near", label: "A few steps back", hint: "1 to 2 m" },
  { id: "middle", label: "Middle of the room", hint: "2 to 4 m" },
  { id: "far", label: "Across the room", hint: "4 m or more" },
];

const SAYINGS: Option<TrainingChoice["saying"]>[] = [
  { id: "wake", label: "“Hey Canvas”" },
  { id: "other", label: "Anything else", hint: "Chatting, or near misses like “Hey Kansas”" },
];

const labelOf = (options: Option<string>[], id: string) => options.find((option) => option.id === id)?.label ?? id;
const clock = (value: string | number) => new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

export function AdminApp() {
  const { training, samples, error, start, stop, remove } = useVoiceTraining();
  const [choice, setChoice] = useState<TrainingChoice>({ speaker: "mike", spot: "close", saying: "wake" });
  // The newest sample when recording started. Only later ones count as "the last try".
  const [baseline, setBaseline] = useState<string | null | undefined>(undefined);
  const tally = useMemo(() => trainingTally(samples), [samples]);
  const latest = baseline !== undefined && samples[0] && samples[0].id !== baseline ? samples[0] : undefined;

  const begin = () => {
    setBaseline(samples[0]?.id ?? null);
    void start(choice);
  };

  // While recording, a new choice labels the next tries straight away.
  const choose = (next: Partial<TrainingChoice>) => {
    const updated = { ...choice, ...next };
    setChoice(updated);
    if (training.active) void start(updated);
  };

  return (
    <section className="admin-app">
      <header className="admin-header">
        <div className="admin-title-icon"><SlidersHorizontal /></div>
        <div>
          <h1>Admin</h1>
          <p>Wake word training</p>
        </div>
      </header>

      <section className="admin-card">
        <p className="training-intro">
          Record the family saying “Hey Canvas” around the room. While it records, Cannvas switches nothing on.
          It shows whether each try would have woken it, and keeps the clips on the Pi for training.
        </p>
        <Choices label="Who's talking" options={SPEAKERS} value={choice.speaker} onChange={(speaker) => choose({ speaker })} />
        <Choices label="Where are they" options={SPOTS} value={choice.spot} onChange={(spot) => choose({ spot })} />
        <Choices label="What they'll say" options={SAYINGS} value={choice.saying} onChange={(saying) => choose({ saying })} />
        <div className="training-actions">
          <button
            className={training.active ? "training-record recording" : "training-record"}
            onClick={() => (training.active ? void stop() : begin())}
          >
            {training.active ? <Square /> : <Mic />}
            {training.active ? "Stop recording" : "Start recording"}
          </button>
          {training.active && <p>Recording. It stops by itself at {clock(training.endsAt)}.</p>}
        </div>
        {error && <p className="training-error" role="alert">{error}</p>}
      </section>

      {(training.active || latest) && <LastTry sample={latest} recording={training.active} saying={choice.saying} />}

      {samples.length > 0 && (
        <section className="admin-card">
          <h2>So far</h2>
          <div className="training-tally">
            {tally.wake.map((row) => (
              <div key={row.speaker}>
                <strong>{labelOf(SPEAKERS, row.speaker)}</strong>
                <span className="training-bar"><i style={{ width: `${(row.woke / row.tries) * 100}%` }} /></span>
                <span>{row.woke} of {row.tries} would wake</span>
              </div>
            ))}
            {tally.other.tries > 0 && (
              <div>
                <strong>Anything else</strong>
                <span className="training-bar mistakes"><i style={{ width: `${(tally.other.mistakes / tally.other.tries) * 100}%` }} /></span>
                <span>{tally.other.mistakes} of {tally.other.tries} would wake by mistake</span>
              </div>
            )}
          </div>

          <h2>Recordings</h2>
          <ul className="training-list">
            {samples.slice(0, 40).map((sample) => (
              <li key={sample.id} className={outcome(sample).className}>
                <span className="training-mark">{outcome(sample).icon}</span>
                <span>
                  <strong>“{sample.heard || "…"}”</strong>
                  <small>
                    {labelOf(SPEAKERS, sample.speaker)} · {labelOf(SPOTS, sample.spot)} · {sample.saying === "wake" ? "Hey Canvas" : "anything else"} · {clock(sample.at)} · {sample.score.toFixed(2)}
                  </small>
                </span>
                <button onClick={() => void remove(sample.id)} aria-label="Delete this recording"><Trash2 /></button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function Choices<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="training-choice">
      <span>{label}</span>
      <div role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option.id} className={value === option.id ? "selected" : ""} aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
            {option.label}
            {option.hint && <small>{option.hint}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

function outcome(sample: VoiceSample) {
  if (sample.saying === "other") {
    return sample.wouldWake
      ? { className: "mistake", icon: <TriangleAlert />, title: "Would wake by mistake" }
      : { className: "ignored", icon: <Check />, title: "Ignored, as it should be" };
  }
  return sample.wouldWake
    ? { className: "woke", icon: <Check />, title: "Would wake" }
    : { className: "missed", icon: <X />, title: "Wouldn't wake" };
}

// Big enough to read from across the room.
function LastTry({ sample, recording, saying }: { sample?: VoiceSample; recording: boolean; saying: TrainingChoice["saying"] }) {
  if (!sample) {
    return (
      <section className="training-result waiting" aria-live="polite">
        <span className="training-mark"><Mic /></span>
        <div>
          <strong>Listening…</strong>
          <p>{saying === "wake" ? "Say “Hey Canvas”" : "Say anything except “Hey Canvas”"}{recording ? "" : " once recording starts"}</p>
        </div>
      </section>
    );
  }
  const { className, icon, title } = outcome(sample);
  return (
    <section className={`training-result ${className}`} aria-live="polite">
      <span className="training-mark">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>“{sample.heard || "…"}” · {labelOf(SPEAKERS, sample.speaker)} · score {sample.score.toFixed(2)}</p>
      </div>
    </section>
  );
}
