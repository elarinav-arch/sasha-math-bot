import { weeklyStars, isActiveThisWeek, WEEKLY_STARS_PER_CHILD } from "./rewards.js";
import type { TeamState } from "./state.js";

export function teamReport(team: TeamState, date: string, weekStart: string): string {
  const children = Object.values(team.children);
  const todaySessions = children.reduce((sum, c) => sum + (c.days.find((d) => d.date === date)?.sessions ?? 0), 0);
  const todayStars = children.reduce((sum, c) => sum + (c.days.find((d) => d.date === date)?.stars ?? 0), 0);
  const activeToday = children.filter((c) => (c.days.find((d) => d.date === date)?.sessions ?? 0) > 0).length;
  const activeThisWeek = children.filter((c) => isActiveThisWeek(c, weekStart));
  const weekTotal = activeThisWeek.reduce((sum, c) => sum + weeklyStars(c, weekStart), 0);
  const weekGoal = activeThisWeek.length * WEEKLY_STARS_PER_CHILD;

  return [
    `📊 Командный отчёт за ${date}`,
    `Детей в команде: ${children.length}, тренировались сегодня: ${activeToday}`,
    `Сегодня: ${todaySessions} сессий, ${todayStars} ⭐`,
    `Неделя: ${weekTotal} из ${weekGoal} ⭐ (${activeThisWeek.length} активных)`,
    `Трофеев у команды: ${team.trophyCards.length}`,
  ].join("\n");
}
