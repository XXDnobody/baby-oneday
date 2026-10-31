export function dateAt(at: Date, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at); }
export function timeAt(at: Date, timezone: string) { return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at); }
export function shiftDate(date: string, days: number) { return new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10); }
export function daysBetween(from: string, to: string) { const dates: string[] = []; for (let d = from; d <= to; d = shiftDate(d, 1)) dates.push(d); return dates; }
export function instant(date: string, time: string, timezone: string) {
  const wanted = Date.parse(date + "T" + time + ":00Z"); let guess = wanted;
  for (let n = 0; n < 3; n++) { const at = new Date(guess); const rendered = Date.parse(dateAt(at, timezone) + "T" + timeAt(at, timezone) + ":00Z"); guess += wanted - rendered; }
  return new Date(guess);
}
