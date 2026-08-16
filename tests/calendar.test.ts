import { expect, test } from "vitest";
import { addDays, isInWeek, localDate, weekStartFor } from "../src/calendar.js";

test("localDate formats Cyprus date as YYYY-MM-DD", () => {
  // 23:30 UTC 4 июля = 02:30 5 июля на Кипре (UTC+3 летом)
  expect(localDate(new Date("2026-07-04T23:30:00Z"))).toBe("2026-07-05");
});

test("addDays shifts a YYYY-MM-DD string forward and backward, across month/year boundaries", () => {
  expect(addDays("2026-08-16", 1)).toBe("2026-08-17");
  expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
});

test("weekStartFor returns the Monday of the week containing the date", () => {
  // 2026-08-16 is a Sunday, 2026-08-17 is a Monday (verified via `date -d`)
  expect(weekStartFor("2026-08-16")).toBe("2026-08-10");
  expect(weekStartFor("2026-08-17")).toBe("2026-08-17");
  expect(weekStartFor("2026-08-20")).toBe("2026-08-17");
});

test("isInWeek checks a date falls within [weekStart, weekStart+6]", () => {
  expect(isInWeek("2026-08-17", "2026-08-17")).toBe(true); // первый день недели
  expect(isInWeek("2026-08-23", "2026-08-17")).toBe(true); // последний день (воскресенье)
  expect(isInWeek("2026-08-24", "2026-08-17")).toBe(false); // уже следующая неделя
  expect(isInWeek("2026-08-16", "2026-08-17")).toBe(false); // предыдущая неделя
});
