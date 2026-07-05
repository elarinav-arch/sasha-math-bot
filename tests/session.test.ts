import { expect, test } from "vitest";
import { emptyProgress } from "../src/state.js";
import { runSession, type SessionIO } from "../src/session.js";
import type { Fact } from "../src/facts.js";

function fact(key: string, q: string, answer: number): Fact {
  return { key, question: q, answer, hint: "подсказка-тест" };
}

function mockIO(replies: string[]) {
  const sent: string[] = [];
  const timeouts: number[] = [];
  let i = 0;
  const io: SessionIO = {
    async send(text) {
      sent.push(text);
    },
    async waitForReply(timeoutMs) {
      timeouts.push(timeoutMs);
      return i < replies.length ? replies[i++] : null;
    },
  };
  return { io, sent, timeouts };
}

const FACTS = [fact("2x3", "2 × 3 = ?", 6), fact("3x3", "3 × 3 = ?", 9)];
const rng = () => 0;

test("all correct: counts, combo praise, levels up", async () => {
  const p = emptyProgress();
  const { io, sent } = mockIO(["6", "9"]);
  const r = await runSession(io, p, FACTS, () => new Date(), rng);
  expect(r).toEqual({ answered: 2, correct: 2, finished: true });
  expect(p.facts["2x3"].level).toBe(1);
  expect(sent.join("\n")).toContain("2 × 3 = ?");
});

test("wrong then correct on 2nd try: hint shown, Leitner counts wrong, no requeue", async () => {
  const p = emptyProgress();
  const { io, sent } = mockIO(["5", "6", "9"]);
  const r = await runSession(io, p, FACTS, () => new Date(), rng);
  expect(r).toEqual({ answered: 2, correct: 1, finished: true });
  expect(sent.join("\n")).toContain("подсказка-тест");
  expect(p.facts["2x3"].wrong).toBe(1);
});

test("wrong twice: answer revealed, fact requeued once at the end", async () => {
  const p = emptyProgress();
  const { io, sent } = mockIO(["5", "5", "9", "6"]);
  const r = await runSession(io, p, FACTS, () => new Date(), rng);
  // 2x3 (двойная ошибка) + 3x3 (верно) + повтор 2x3 (верно)
  expect(r.answered).toBe(3);
  expect(r.correct).toBe(2);
  expect(sent.join("\n")).toContain("Правильный ответ: 6");
});

test("stop is refused before 5 answers, accepted after", async () => {
  const five = [
    fact("2x2", "2 × 2 = ?", 4), fact("2x3", "2 × 3 = ?", 6), fact("2x4", "2 × 4 = ?", 8),
    fact("2x5", "2 × 5 = ?", 10), fact("2x6", "2 × 6 = ?", 12), fact("2x7", "2 × 7 = ?", 14),
  ];
  const p = emptyProgress();
  const { io, sent } = mockIO(["стоп", "4", "6", "8", "10", "12", "стоп"]);
  const r = await runSession(io, p, five, () => new Date(), rng);
  expect(r).toEqual({ answered: 5, correct: 5, finished: true });
  expect(sent.join("\n")).toContain("Ещё 5");
});

test("non-numeric input asks for digits without wasting the attempt", async () => {
  const p = emptyProgress();
  const { io, sent } = mockIO(["не знаю", "6", "9"]);
  const r = await runSession(io, p, FACTS, () => new Date(), rng);
  expect(r).toEqual({ answered: 2, correct: 2, finished: true });
  expect(sent.join("\n")).toContain("цифрами");
});

test("timeout before any answer -> finished:false", async () => {
  const p = emptyProgress();
  const { io } = mockIO([]);
  const r = await runSession(io, p, FACTS, () => new Date(), rng);
  expect(r).toEqual({ answered: 0, correct: 0, finished: false });
});

test("first answer is awaited for the whole hour, later ones for 4 minutes", async () => {
  const p = emptyProgress();
  const { io, timeouts } = mockIO(["6", "9"]);
  await runSession(io, p, FACTS, () => new Date(), rng);
  expect(timeouts[0]).toBe(60 * 60 * 1000);
  expect(timeouts[1]).toBe(4 * 60 * 1000);
});

test("greeting tells how long the bot waits", async () => {
  const p = emptyProgress();
  const { io, sent } = mockIO(["6", "9"]);
  await runSession(io, p, FACTS, () => new Date(), rng);
  expect(sent[0]).toContain("час");
});
