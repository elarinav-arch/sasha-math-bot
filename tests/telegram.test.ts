import { expect, test } from "vitest";
import { nextReply, TelegramIO, type Telegram, type Update } from "../src/telegram.js";

function upd(id: number, chatId: number, text: string, dateSec: number): Update {
  return { update_id: id, message: { message_id: id, date: dateSec, text, chat: { id: chatId } } };
}

test("returns first message from the right chat and advances offset", () => {
  const updates = [upd(10, 999, "чужое", 1000), upd(11, 42, "6", 1000), upd(12, 42, "7", 1001)];
  const r = nextReply(updates, 42, 0);
  expect(r.text).toBe("6");
  expect(r.offset).toBe(13); // offset двигаем за всю пачку
});

test("ignores stale queued messages sent before the session window", () => {
  const updates = [upd(10, 42, "старое", 100), upd(11, 42, "свежее", 2000)];
  const r = nextReply(updates, 42, 1_000_000); // notBeforeMs = 1000 сек
  expect(r.text).toBe("свежее");
});

test("returns null text when nothing relevant", () => {
  const updates = [upd(10, 999, "чужое", 2000)];
  const r = nextReply(updates, 42, 0);
  expect(r.text).toBeNull();
  expect(r.offset).toBe(11);
});

test("extendDeadline sets a fresh deadline relative to now, not additive on the stale original", () => {
  const fakeTg = {} as unknown as Telegram;
  // Исходный дедлайн — далеко в прошлом (условный старт сессии), чтобы аддитивный
  // баг (this.deadlineMs += extraMs, отсчёт от СТАРОГО значения) дал результат,
  // который явно НЕ близок к "сейчас + extraMs".
  const io = new TelegramIO(fakeTg, 1, 1_000_000, 1_000_000 + 60 * 60_000);
  const before = Date.now();
  io.extendDeadline(20 * 60_000);
  const deadline = (io as unknown as { deadlineMs: number }).deadlineMs;
  expect(deadline).toBeGreaterThanOrEqual(before + 20 * 60_000 - 1000);
  expect(deadline).toBeLessThanOrEqual(before + 20 * 60_000 + 1000);
});
