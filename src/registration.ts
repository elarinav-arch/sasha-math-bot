import { emptyChildProgress, type TeamState } from "./state.js";

export type JoinResult =
  | { kind: "welcome"; name: string }
  | { kind: "already-member" }
  | { kind: "wrong-code" };

// Чистая функция (кроме мутации team при успехе) — легко тестируется без Telegram.
export function tryJoin(
  team: TeamState,
  text: string,
  expectedCode: string,
  chatId: number,
  firstName: string,
  now: Date,
): JoinResult {
  if (team.children[chatId]) return { kind: "already-member" };
  const match = text.trim().match(/^\/join\s+(\S+)$/i);
  if (!match || match[1] !== expectedCode) return { kind: "wrong-code" };
  team.children[chatId] = emptyChildProgress(chatId, firstName, now.toISOString());
  return { kind: "welcome", name: firstName };
}
