import { expect, test, vi } from "vitest";
import { dispatchUpdates, PolledIO, TelegramPoller, type Update } from "../src/telegram.js";
import type { Telegram } from "../src/telegram.js";

function upd(id: number, chatId: number, text: string, dateSec: number, firstName?: string): Update {
  return {
    update_id: id,
    message: { message_id: id, date: dateSec, text, chat: { id: chatId }, from: firstName ? { first_name: firstName } : undefined },
  };
}

function fakeTelegram(getUpdates: () => Promise<Update[]>): Telegram {
  return { getUpdates } as unknown as Telegram;
}

test("delivers one message per distinct chat in a batch, tagged with sender name", () => {
  const updates = [upd(10, 100, "6", 1000, "Саша"), upd(11, 200, "9", 1000, "Женя")];
  const r = dispatchUpdates(updates, 0);
  expect(r.offset).toBe(12);
  expect(r.delivered).toEqual([
    { chatId: 100, text: "6", fromName: "Саша" },
    { chatId: 200, text: "9", fromName: "Женя" },
  ]);
});

test("only the first message per chat in a batch is delivered, offset still advances past all of them", () => {
  const updates = [upd(10, 100, "6", 1000), upd(11, 100, "7", 1000)];
  const r = dispatchUpdates(updates, 0);
  expect(r.delivered).toEqual([{ chatId: 100, text: "6", fromName: "друг" }]);
  expect(r.offset).toBe(12);
});

test("ignores stale queued messages sent before notBeforeMs", () => {
  const updates = [upd(10, 100, "старое", 100), upd(11, 100, "свежее", 2000)];
  const r = dispatchUpdates(updates, 1_000_000); // notBeforeMs = 1000 сек
  expect(r.delivered).toEqual([{ chatId: 100, text: "свежее", fromName: "друг" }]);
});

test("messages without text are skipped, offset still advances", () => {
  const updates: Update[] = [{ update_id: 5, message: { message_id: 5, date: 100, chat: { id: 100 } } }];
  const r = dispatchUpdates(updates, 0);
  expect(r.delivered).toEqual([]);
  expect(r.offset).toBe(6);
});

test("empty batch returns offset 0 and no deliveries", () => {
  const r = dispatchUpdates([], 0);
  expect(r).toEqual({ offset: 0, delivered: [] });
});

test("missing sender name falls back to a friendly default", () => {
  const r = dispatchUpdates([upd(10, 100, "/join X", 1000)], 0);
  expect(r.delivered[0].fromName).toBe("друг");
});

test("pollOnce resolves a waiting child's promise when their message arrives", async () => {
  const tg = fakeTelegram(async () => [upd(1, 42, "6", 1000)]);
  const poller = new TelegramPoller(tg, 0); // startedAtMs=0 — сообщение с датой 1000с не покажется устаревшим
  const waitPromise = poller.waitFor(42, 5000);
  await poller.pollOnce(() => {});
  expect(await waitPromise).toBe("6");
});

test("pollOnce routes messages from chats with no active waiter to onUnmatched", async () => {
  const tg = fakeTelegram(async () => [upd(1, 999, "/join ABC", 1000)]);
  const poller = new TelegramPoller(tg, 0);
  const unmatched: { chatId: number; text: string; fromName: string }[] = [];
  await poller.pollOnce((msg) => unmatched.push(msg));
  expect(unmatched).toEqual([{ chatId: 999, text: "/join ABC", fromName: "друг" }]);
});

test("waitFor resolves null if no matching message arrives before the timeout", async () => {
  vi.useFakeTimers();
  const tg = fakeTelegram(async () => []);
  const poller = new TelegramPoller(tg, 0);
  const p = poller.waitFor(42, 100);
  vi.advanceTimersByTime(150);
  expect(await p).toBeNull();
  vi.useRealTimers();
});

test("send delegates to the underlying Telegram client", async () => {
  const sent: { chatId: number | string; text: string }[] = [];
  const tg = { getUpdates: async () => [], sendMessage: async (chatId: number | string, text: string) => { sent.push({ chatId, text }); } } as unknown as Telegram;
  const poller = new TelegramPoller(tg, 0);
  await poller.send(42, "привет");
  expect(sent).toEqual([{ chatId: 42, text: "привет" }]);
});

test("offset regression guard: a later empty poll does not reset offset back to 0", async () => {
  const calls: number[] = [];
  const tg = {
    getUpdates: async (offset: number) => {
      calls.push(offset);
      return calls.length === 1 ? [upd(10, 100, "6", 1000)] : [];
    },
  } as unknown as Telegram;
  const poller = new TelegramPoller(tg, 0);
  await poller.pollOnce(() => {});
  await poller.pollOnce(() => {});
  expect(calls).toEqual([0, 11]);
});

test("two children with concurrent waitFor calls for different chatIds both resolve independently from one batch", async () => {
  const tg = fakeTelegram(async () => [upd(1, 100, "6", 1000), upd(2, 200, "9", 1000)]);
  const poller = new TelegramPoller(tg, 0);
  const waitA = poller.waitFor(100, 5000);
  const waitB = poller.waitFor(200, 5000);
  await poller.pollOnce(() => {});
  expect(await waitA).toBe("6");
  expect(await waitB).toBe("9");
});

test("regression: a shorter waitFor's timeout does not delete a longer concurrent waitFor for the same chatId", async () => {
  vi.useFakeTimers();
  let pending: Update[] = [];
  const tg = fakeTelegram(async () => {
    const batch = pending;
    pending = [];
    return batch;
  });
  const poller = new TelegramPoller(tg, 0);

  const w1 = poller.waitFor(42, 1000); // registered at t=0, times out at t=1000
  await vi.advanceTimersByTimeAsync(200);
  const w2 = poller.waitFor(42, 3000); // registered at t=200, times out at t=3200

  await vi.advanceTimersByTimeAsync(800); // t=1000: w1's timer fires
  expect(await w1).toBeNull();

  // Message for chatId 42 arrives at t=1500, well within w2's window.
  await vi.advanceTimersByTimeAsync(300); // t=1300
  pending = [upd(1, 42, "6", 1500)];
  await vi.advanceTimersByTimeAsync(200); // t=1500
  await poller.pollOnce(() => {});

  expect(await w2).toBe("6");
  vi.useRealTimers();
});

test("PolledIO.send delegates to the poller for its own chatId", async () => {
  const sent: { chatId: number | string; text: string }[] = [];
  const tg = { getUpdates: async () => [], sendMessage: async (chatId: number | string, text: string) => { sent.push({ chatId, text }); } } as unknown as Telegram;
  const poller = new TelegramPoller(tg, 0);
  const io = new PolledIO(poller, 42, Date.now() + 60_000);
  await io.send("привет");
  expect(sent).toEqual([{ chatId: 42, text: "привет" }]);
});

test("PolledIO.waitForReply resolves via the poller when a matching message is dispatched", async () => {
  const tg = fakeTelegram(async () => [upd(1, 42, "6", 1000)]);
  const poller = new TelegramPoller(tg, 0);
  const io = new PolledIO(poller, 42, Date.now() + 60_000);
  const replyPromise = io.waitForReply(5000);
  await poller.pollOnce(() => {});
  expect(await replyPromise).toBe("6");
});

test("PolledIO.waitForReply returns null once the per-child deadline has passed, even with time left on timeoutMs", async () => {
  vi.useFakeTimers();
  const tg = fakeTelegram(async () => []);
  const poller = new TelegramPoller(tg, 0);
  const io = new PolledIO(poller, 42, Date.now() + 50); // дедлайн через 50мс
  const p = io.waitForReply(5000); // просит подождать 5с, но дедлайн раньше
  vi.advanceTimersByTime(100);
  expect(await p).toBeNull();
  vi.useRealTimers();
});

test("PolledIO.extendDeadline resets the deadline relative to now, not additive on the stale original", () => {
  const tg = fakeTelegram(async () => []);
  const poller = new TelegramPoller(tg, 0);
  const io = new PolledIO(poller, 42, 1_000_000); // старый дедлайн — в прошлом
  const before = Date.now();
  io.extendDeadline(20 * 60_000);
  const deadline = (io as unknown as { deadlineMs: number }).deadlineMs;
  expect(deadline).toBeGreaterThanOrEqual(before + 20 * 60_000 - 1000);
  expect(deadline).toBeLessThanOrEqual(before + 20 * 60_000 + 1000);
});
