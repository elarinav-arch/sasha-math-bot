import { expect, test } from "vitest";
import { emptyChildProgress, emptyTeamState } from "../src/state.js";
import { recordSession } from "../src/rewards.js";
import { teamReport } from "../src/report.js";

test("teamReport summarizes today's and this week's team activity", () => {
  const team = emptyTeamState();
  team.children[1] = emptyChildProgress(1, "Саша", "");
  team.children[2] = emptyChildProgress(2, "Женя", "");
  recordSession(team.children[1], "2026-08-17", 3);
  recordSession(team.children[1], "2026-08-17", 2);
  recordSession(team.children[2], "2026-08-17", 1);
  team.trophyCards = ["trophy01"];
  const text = teamReport(team, "2026-08-17", "2026-08-17");
  expect(text).toContain("Детей в команде: 2");
  expect(text).toContain("тренировались сегодня: 2");
  expect(text).toContain("3 сессий, 6 ⭐");
});

test("teamReport counts today's sessions and stars across all children", () => {
  const team = emptyTeamState();
  team.children[1] = emptyChildProgress(1, "Саша", "");
  team.children[2] = emptyChildProgress(2, "Женя", "");
  recordSession(team.children[1], "2026-08-17", 3); // 1 сессия, 3 звезды
  recordSession(team.children[2], "2026-08-17", 2); // 1 сессия, 2 звезды
  const text = teamReport(team, "2026-08-17", "2026-08-17");
  expect(text).toContain("2 сессий, 5 ⭐");
});

test("teamReport shows weekly progress toward the goal, scaled by active children", () => {
  const team = emptyTeamState();
  team.children[1] = emptyChildProgress(1, "Саша", "");
  recordSession(team.children[1], "2026-08-17", 5);
  const text = teamReport(team, "2026-08-17", "2026-08-17");
  expect(text).toContain("5 из 20 ⭐"); // 1 активный ребёнок × 20
});

test("teamReport with an empty team doesn't crash and shows zeros", () => {
  const team = emptyTeamState();
  const text = teamReport(team, "2026-08-17", "2026-08-17");
  expect(text).toContain("Детей в команде: 0");
  expect(text).toContain("0 из 0 ⭐");
});
