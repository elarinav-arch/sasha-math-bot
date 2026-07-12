import { expect, test } from "vitest";
import { activeSlot, localDate } from "../src/index.js";

// Кипр летом — UTC+3. Окна сплошные (без промежутков): 14:00–17:00 / 17:00–19:00 /
// 19:00–22:00 Кипр — так любое (даже сильно опоздавшее) срабатывание GitHub cron
// в течение дня попадёт хоть в какое-то окно, а не потеряется между ними.
test("activeSlot covers contiguous windows with no gaps between them", () => {
  expect(activeSlot(new Date("2026-07-05T11:00:00Z"))).toBe("morning"); // 14:00 Кипр
  expect(activeSlot(new Date("2026-07-05T13:59:00Z"))).toBe("morning"); // 16:59 Кипр
  expect(activeSlot(new Date("2026-07-05T14:00:00Z"))).toBe("midday"); // 17:00 Кипр — граница
  expect(activeSlot(new Date("2026-07-05T15:59:00Z"))).toBe("midday"); // 18:59 Кипр
  expect(activeSlot(new Date("2026-07-05T16:00:00Z"))).toBe("evening"); // 19:00 Кипр — граница
  expect(activeSlot(new Date("2026-07-05T18:59:00Z"))).toBe("evening"); // 21:59 Кипр
});

test("activeSlot returns null before 14:00 and after 22:00 Кипр (ночь, отдых)", () => {
  expect(activeSlot(new Date("2026-07-05T09:00:00Z"))).toBeNull(); // 12:00 Кипр
  expect(activeSlot(new Date("2026-07-05T19:00:00Z"))).toBeNull(); // 22:00 Кипр
  expect(activeSlot(new Date("2026-07-05T23:00:00Z"))).toBeNull(); // 02:00 Кипр (ночь)
});

test("localDate formats Cyprus date as YYYY-MM-DD", () => {
  // 23:30 UTC 4 июля = 02:30 5 июля на Кипре (UTC+3 летом)
  expect(localDate(new Date("2026-07-04T23:30:00Z"))).toBe("2026-07-05");
});
