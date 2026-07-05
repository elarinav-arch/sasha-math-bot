import type { Progress } from "./state.js";

export function parentReport(p: Progress, date: string): string {
  const day = p.days.find((d) => d.date === date);
  const weak = Object.entries(p.facts)
    .filter(([, f]) => f.wrong > 0 && f.level <= 1)
    .sort((a, b) => a[1].level - b[1].level || b[1].wrong - a[1].wrong)
    .slice(0, 3)
    .map(([k]) => k.replace("x", " × ").replace("/", " ÷ "));
  return [
    `📊 Отчёт за ${date}`,
    `Сессий: ${day?.sessions ?? 0} из 3, звёзд за день: ${day?.stars ?? 0} ⭐`,
    `Серия дней: ${p.streak} 🔥 | Карточек: ${p.cards.length}`,
    weak.length > 0 ? `Западают: ${weak.join(", ")}` : "Слабых мест не замечено 💪",
  ].join("\n");
}
