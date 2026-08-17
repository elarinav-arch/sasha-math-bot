import { expect, test } from "vitest";
import { emptyTeamState } from "../src/state.js";
import { registerChild, validateName } from "../src/registration.js";

test("validateName trims surrounding whitespace", () => {
  expect(validateName("  Саша  ")).toBe("Саша");
});

test("validateName collapses repeated internal whitespace", () => {
  expect(validateName("Са   ша")).toBe("Са ша");
});

test("validateName rejects an empty string", () => {
  expect(validateName("")).toBeNull();
});

test("validateName rejects a whitespace-only string", () => {
  expect(validateName("   ")).toBeNull();
});

test("validateName accepts exactly 30 characters, rejects 31", () => {
  expect(validateName("a".repeat(30))).toBe("a".repeat(30));
  expect(validateName("a".repeat(31))).toBeNull();
});

test("registerChild creates a new ChildProgress keyed by chatId with the given name", () => {
  const team = emptyTeamState();
  const now = new Date("2026-08-17T12:00:00Z");
  registerChild(team, 100, "Саша", now);
  expect(team.children[100]).toEqual({
    chatId: 100, name: "Саша", joinedAt: now.toISOString(),
    facts: {}, days: [], streak: 0, cards: [], totalStars: 0,
  });
});
