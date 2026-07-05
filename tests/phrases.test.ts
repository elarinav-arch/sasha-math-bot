import { expect, test } from "vitest";
import { GREETINGS, PRAISE, COMBO, WRONG, SECOND_TRY, pick } from "../src/phrases.js";

test("all phrase pools are non-empty", () => {
  for (const pool of [GREETINGS, PRAISE, WRONG, SECOND_TRY]) {
    expect(pool.length).toBeGreaterThanOrEqual(3);
  }
  expect(COMBO.length).toBeGreaterThanOrEqual(2);
});

test("pick is deterministic with a fixed rng", () => {
  expect(pick(["a", "b", "c"], () => 0)).toBe("a");
  expect(pick(["a", "b", "c"], () => 0.99)).toBe("c");
});

test("combo phrases include the combo number", () => {
  for (const fn of COMBO) expect(fn(4)).toContain("4");
});
