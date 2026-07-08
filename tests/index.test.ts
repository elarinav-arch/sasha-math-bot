import { expect, test } from "vitest";
import { activeSlot, localDate } from "../src/index.js";

// Кипр летом — UTC+3, поэтому 11:00 UTC = 14:00 Кипр и т.д.
test("activeSlot matches the training window whose hour it falls in", () => {
  expect(activeSlot(new Date("2026-07-05T11:00:00Z"), 60)).toBe("morning"); // 14:00 Кипр
  expect(activeSlot(new Date("2026-07-05T11:59:00Z"), 60)).toBe("morning"); // 14:59 Кипр
  expect(activeSlot(new Date("2026-07-05T14:00:00Z"), 60)).toBe("midday"); // 17:00 Кипр
  expect(activeSlot(new Date("2026-07-05T16:30:00Z"), 60)).toBe("evening"); // 19:30 Кипр
});

test("activeSlot returns null outside any training window", () => {
  expect(activeSlot(new Date("2026-07-05T12:00:00Z"), 60)).toBeNull(); // 15:00 Кипр — окно уже закрылось
  expect(activeSlot(new Date("2026-07-05T13:00:00Z"), 60)).toBeNull(); // 16:00 Кипр — до вечернего окна
  expect(activeSlot(new Date("2026-07-05T20:00:00Z"), 60)).toBeNull(); // 23:00 Кипр
});

test("localDate formats Cyprus date as YYYY-MM-DD", () => {
  // 23:30 UTC 4 июля = 02:30 5 июля на Кипре (UTC+3 летом)
  expect(localDate(new Date("2026-07-04T23:30:00Z"))).toBe("2026-07-05");
});
