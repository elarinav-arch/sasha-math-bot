import type { Fact } from "./facts.js";
import type { Progress } from "./state.js";
import { applyResult } from "./leitner.js";
import { collectionSummary } from "./rewards.js";
import { COMBO, GREETINGS, PRAISE, SECOND_TRY, WRONG, pick } from "./phrases.js";

export interface SessionIO {
  send(text: string): Promise<void>;
  // null = таймаут ожидания
  waitForReply(timeoutMs: number): Promise<string | null>;
}

export interface SessionResult {
  answered: number;
  correct: number; // верно с первой попытки
  finished: boolean; // false = не ответила ни разу
}

const REPLY_TIMEOUT_MS = 4 * 60 * 1000;
const MIN_TO_STOP = 5;

type Answer =
  | { kind: "correct" }
  | { kind: "second" }
  | { kind: "wrong" }
  | { kind: "stop" }
  | { kind: "timeout" };

export async function runSession(
  io: SessionIO,
  progress: Progress,
  facts: Fact[],
  now: () => Date = () => new Date(),
  rng: () => number = Math.random,
): Promise<SessionResult> {
  await io.send(
    pick(GREETINGS, rng) +
      `\n\nЗадание: ${facts.length} примеров. После ${MIN_TO_STOP} можно написать «стоп». Поехали! 🚀`,
  );

  const queue = [...facts];
  const retried = new Set<string>();
  let answered = 0;
  let correct = 0;
  let combo = 0;

  while (queue.length > 0) {
    const f = queue.shift()!;
    await io.send(`✏️ ${f.question}`);
    const a = await ask(io, progress, f, rng);

    if (a.kind === "timeout") {
      if (answered === 0) return { answered, correct, finished: false };
      await io.send("Кажется, ты убежала 🙂 Сохраняю результат — увидимся на следующей тренировке!");
      break;
    }
    if (a.kind === "stop") {
      if (answered >= MIN_TO_STOP) {
        await io.send("Окей, стоп так стоп! Ты молодец, что позанималась 💪");
        break;
      }
      await io.send(`Ещё ${MIN_TO_STOP - answered} примеров до «стоп» 🙂 Продолжаем!`);
      queue.unshift(f);
      continue;
    }

    answered++;
    if (a.kind === "correct") {
      correct++;
      combo++;
      applyResult(progress, f.key, true, now());
      let msg = pick(PRAISE, rng);
      if (combo >= 3) msg += "\n" + pick(COMBO, rng)(combo);
      await io.send(msg);
    } else {
      combo = 0;
      applyResult(progress, f.key, false, now());
      if (a.kind === "second") {
        await io.send(pick(SECOND_TRY, rng));
      } else if (!retried.has(f.key)) {
        retried.add(f.key);
        queue.push(f);
      }
    }
  }

  return { answered, correct, finished: true };
}

async function ask(io: SessionIO, progress: Progress, f: Fact, rng: () => number): Promise<Answer> {
  let attempt = 1;
  for (;;) {
    const reply = await io.waitForReply(REPLY_TIMEOUT_MS);
    if (reply === null) return { kind: "timeout" };
    const text = reply.trim().toLowerCase();
    if (text === "стоп" || text === "stop") return { kind: "stop" };
    if (text === "/коллекция" || text === "/collection") {
      await io.send(collectionSummary(progress));
      continue;
    }
    if (!/^\d+$/.test(text)) {
      await io.send("Напиши ответ цифрами 🙂 Например: 42");
      continue;
    }
    const num = Number(text);
    if (num === f.answer) return attempt === 1 ? { kind: "correct" } : { kind: "second" };
    if (attempt === 1) {
      attempt = 2;
      await io.send(`${pick(WRONG, rng)}\n💡 ${f.hint}\nПопробуй ещё раз!`);
    } else {
      await io.send(`Правильный ответ: ${f.answer}. Этот пример ещё вернётся — и ты его победишь! 💪`);
      return { kind: "wrong" };
    }
  }
}
