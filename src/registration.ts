import { emptyChildProgress, type TeamState } from "./state.js";

const MAX_NAME_LENGTH = 30;

// Обрезает пробелы по краям, схлопывает повторы пробелов внутри. null — не
// прошло валидацию (пусто после очистки или длиннее лимита).
export function validateName(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0 || cleaned.length > MAX_NAME_LENGTH) return null;
  return cleaned;
}

// Создаёт профиль ребёнка с именем, которое он ввёл сам (не из Telegram-профиля).
export function registerChild(team: TeamState, chatId: number, name: string, now: Date): void {
  team.children[chatId] = emptyChildProgress(chatId, name, now.toISOString());
}
