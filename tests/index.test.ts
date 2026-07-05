import { expect, test } from "vitest";
import { slotForHourUtc, localDate } from "../src/index.js";

test("slot detection by UTC hour", () => {
  expect(slotForHourUtc(7)).toBe("morning");
  expect(slotForHourUtc(11)).toBe("midday");
  expect(slotForHourUtc(14)).toBe("evening");
  expect(slotForHourUtc(20)).toBe("evening");
});

test("localDate formats Cyprus date as YYYY-MM-DD", () => {
  // 23:30 UTC 4 июля = 02:30 5 июля на Кипре (UTC+3 летом)
  expect(localDate(new Date("2026-07-04T23:30:00Z"))).toBe("2026-07-05");
});
