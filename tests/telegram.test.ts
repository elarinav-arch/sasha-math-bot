import { expect, test } from "vitest";
import { dispatchUpdates, type Update } from "../src/telegram.js";

function upd(id: number, chatId: number, text: string, dateSec: number, firstName?: string): Update {
  return {
    update_id: id,
    message: { message_id: id, date: dateSec, text, chat: { id: chatId }, from: firstName ? { first_name: firstName } : undefined },
  };
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
