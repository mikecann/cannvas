const pad = (value: number) => String(value).padStart(2, "0");

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - ((day + 6) % 7));
  result.setHours(0, 0, 0, 0);
  return result;
}

export function money(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

export function longDate(value: string): string {
  return fromDateKey(value).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "5:52 pm" */
export function clockTime(date: Date): string {
  return date.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

/** When something happened: "5:52 pm" today, "Yesterday 5:52 pm", "Sat 5:52 pm" this week, then "18 Oct". */
export function whenLabel(date: Date, now: Date): string {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return clockTime(date);
  if (days === 1) return `Yesterday ${clockTime(date)}`;
  if (days < 7) return `${date.toLocaleDateString("en-AU", { weekday: "short" })} ${clockTime(date)}`;
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
