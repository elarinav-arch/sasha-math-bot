import { expect, test } from "vitest";
import { emptyTeamState } from "../src/state.js";
import { tryJoin } from "../src/registration.js";

const NOW = new Date("2026-08-16T12:00:00Z");

test("correct code registers a new child using their Telegram first name", () => {
  const team = emptyTeamState();
  const result = tryJoin(team, "/join SECRET42", "SECRET42", 100, "Саша", NOW);
  expect(result).toEqual({ kind: "welcome", name: "Саша" });
  expect(team.children[100]).toEqual({
    chatId: 100, name: "Саша", joinedAt: NOW.toISOString(),
    facts: {}, days: [], streak: 0, cards: [], totalStars: 0,
  });
});

test("wrong code does not register anyone", () => {
  const team = emptyTeamState();
  const result = tryJoin(team, "/join WRONG", "SECRET42", 100, "Саша", NOW);
  expect(result).toEqual({ kind: "wrong-code" });
  expect(team.children[100]).toBeUndefined();
});

test("text that isn't a /join command is treated as wrong-code (ignored)", () => {
  const team = emptyTeamState();
  expect(tryJoin(team, "привет!", "SECRET42", 100, "Саша", NOW)).toEqual({ kind: "wrong-code" });
});

test("an already-registered chatId gets a friendly already-member response, code not re-checked", () => {
  const team = emptyTeamState();
  tryJoin(team, "/join SECRET42", "SECRET42", 100, "Саша", NOW);
  const result = tryJoin(team, "/join WRONG-CODE-DOESNT-MATTER", "SECRET42", 100, "Саша", NOW);
  expect(result).toEqual({ kind: "already-member" });
});

test("/join is case-insensitive on the command itself but exact on the code", () => {
  const team = emptyTeamState();
  expect(tryJoin(team, "/JOIN SECRET42", "SECRET42", 100, "Саша", NOW).kind).toBe("welcome");
  expect(tryJoin(team, "/join secret42", "SECRET42", 200, "Саша", NOW).kind).toBe("wrong-code");
});
