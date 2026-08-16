export function localDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Nicosia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

// Понедельник недели, к которой относится dateStr.
export function weekStartFor(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  return addDays(dateStr, -diffToMonday);
}

export function isInWeek(dateStr: string, weekStart: string): boolean {
  const end = addDays(weekStart, 6);
  return dateStr >= weekStart && dateStr <= end;
}
