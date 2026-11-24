// "19:00"-style wall times. Kept free of React and fetch so the tests can load it straight into Node.

/** "19:00" as "7:00pm". */
export function formatClockTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")}${hours < 12 ? "am" : "pm"}`;
}

/** "23:45" moved to the next `step` minutes later (or earlier), wrapping round midnight. */
export function shiftClockTime(value: string, step: number, direction: 1 | -1): string {
  const [hours, mins] = value.split(":").map(Number);
  const now = hours * 60 + mins;
  const moved = direction > 0 ? Math.floor(now / step) * step + step : Math.ceil(now / step) * step - step;
  const total = ((moved % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
