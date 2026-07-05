import { expect, test } from "vitest";
import { allFacts } from "../src/facts.js";

test("generates 64 multiplication and 64 division facts with unique keys", () => {
  const facts = allFacts();
  expect(facts).toHaveLength(128);
  expect(new Set(facts.map((f) => f.key)).size).toBe(128);
});

test("multiplication fact is correct", () => {
  const f = allFacts().find((x) => x.key === "7x8")!;
  expect(f.question).toBe("7 × 8 = ?");
  expect(f.answer).toBe(56);
  expect(f.hint).toContain("5, 6, 7, 8");
});

test("division fact is correct and hints via multiplication", () => {
  const f = allFacts().find((x) => x.key === "56/8")!;
  expect(f.question).toBe("56 ÷ 8 = ?");
  expect(f.answer).toBe(7);
  expect(f.hint).toContain("8 × ? = 56");
});

test("every fact has a non-empty hint", () => {
  for (const f of allFacts()) expect(f.hint.length).toBeGreaterThan(10);
});
