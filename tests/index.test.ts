import { expect, test } from "vitest";
import { slotForHourUtc, localDate } from "../src/index.js";

test("slot detection by UTC hour", () => {
  expect(slotForHourUtc(11)).toBe("morning"); // 14:00 Кипр — первая тренировка
  expect(slotForHourUtc(14)).toBe("midday"); // 17:00 Кипр — вторая
  expect(slotForHourUtc(16)).toBe("evening"); // 19:00 Кипр — последняя, финал дня
  expect(slotForHourUtc(20)).toBe("evening");
});

test("localDate formats Cyprus date as YYYY-MM-DD", () => {
  // 23:30 UTC 4 июля = 02:30 5 июля на Кипре (UTC+3 летом)
  expect(localDate(new Date("2026-07-04T23:30:00Z"))).toBe("2026-07-05");
});
