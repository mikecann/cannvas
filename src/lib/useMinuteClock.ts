import { useEffect, useState } from "react";

/** The current time, updated just after each minute starts. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      const current = new Date();
      const untilNextMinute = 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds());
      // A little past the boundary, so a slightly early timer still lands in the new minute.
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, untilNextMinute + 50);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  return now;
}
