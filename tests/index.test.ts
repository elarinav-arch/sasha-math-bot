import { expect, test, vi } from "vitest";
import { activeSlot, runChildSlot } from "../src/index.js";
import { TelegramPoller, type Telegram } from "../src/telegram.js";
import { emptyChildProgress, getDay } from "../src/state.js";

test("activeSlot covers contiguous windows with no gaps between them", () => {
  expect(activeSlot(new Date("2026-07-05T11:00:00Z"))).toBe("morning"); // 14:00 Кипр
  expect(activeSlot(new Date("2026-07-05T13:59:00Z"))).toBe("morning"); // 16:59 Кипр
  expect(activeSlot(new Date("2026-07-05T14:00:00Z"))).toBe("midday"); // 17:00 Кипр — граница
  expect(activeSlot(new Date("2026-07-05T15:59:00Z"))).toBe("midday"); // 18:59 Кипр
  expect(activeSlot(new Date("2026-07-05T16:00:00Z"))).toBe("evening"); // 19:00 Кипр — граница
  expect(activeSlot(new Date("2026-07-05T18:59:00Z"))).toBe("evening"); // 21:59 Кипр
});

test("activeSlot returns null before 14:00 and after 22:00 Кипр (ночь, отдых)", () => {
  expect(activeSlot(new Date("2026-07-05T09:00:00Z"))).toBeNull(); // 12:00 Кипр
  expect(activeSlot(new Date("2026-07-05T19:00:00Z"))).toBeNull(); // 22:00 Кипр
  expect(activeSlot(new Date("2026-07-05T23:00:00Z"))).toBeNull(); // 02:00 Кипр (ночь)
});

function fakeTelegram(overrides: Partial<Telegram> = {}): Telegram {
  return {
    getUpdates: async () => [],
    sendMessage: async () => {},
    sendPhoto: async () => {},
    ...overrides,
  } as unknown as Telegram;
}

// Fix 1: poller.run(...).catch(...) — a poller failure must never surface as an
// unhandled rejection; it must resolve to a settled (non-rejecting) promise once caught,
// exactly the way main() now wraps it.
test("a TelegramPoller.run() rejection is absorbed by the .catch wrapping used in main(), not left to reject", async () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const tg = fakeTelegram({
    getUpdates: async () => {
      throw new Error("network hiccup");
    },
  });
  const poller = new TelegramPoller(tg, 0);

  const pollerDone = poller
    .run(() => {})
    .catch((err) => {
      console.error("TelegramPoller stopped unexpectedly (no more /join handling this run):", err);
    });

  await expect(pollerDone).resolves.toBeUndefined();
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    "TelegramPoller stopped unexpectedly (no more /join handling this run):",
    expect.any(Error),
  );

  consoleErrorSpy.mockRestore();
});

// Fix 2: each runChildSlot(...) call in the Promise.all batch is wrapped with its own
// .catch(...) so one child's thrown error can't reject the whole batch and wipe out
// siblings' already-completed progress.
test("one child's runChildSlot rejection is isolated by per-child .catch, siblings still settle", async () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const sentToB: string[] = [];
  const tg = fakeTelegram({
    sendMessage: async (chatId: number | string, text: string) => {
      if (chatId === 111) throw new Error("Forbidden: bot was blocked by the user");
      sentToB.push(text);
    },
  });
  const poller = new TelegramPoller(tg, 0);
  vi.spyOn(poller, "waitFor").mockResolvedValue(null); // both children time out waiting for a reply

  const childA = emptyChildProgress(111, "A", "2026-01-01");
  const childB = emptyChildProgress(222, "B", "2026-01-01");
  const date = "2026-08-16";

  // Same shape main() uses: Promise.all(dueChildren.map((child) => runChildSlot(...).catch(...)))
  await Promise.all(
    [childA, childB].map((child) =>
      runChildSlot(poller, tg, child, date, "morning").catch((err) => {
        console.error(`Session failed for child ${child.chatId} (${child.name}):`, err);
      }),
    ),
  );

  expect(consoleErrorSpy).toHaveBeenCalledWith(
    "Session failed for child 111 (A):",
    expect.any(Error),
  );
  expect(sentToB.length).toBeGreaterThan(0); // sibling B's session still completed normally

  consoleErrorSpy.mockRestore();
});

// Fix 3: the evening branch of runChildSlot must announce the streak card finishDay() returns,
// not just silently apply it to child.cards.
test("runChildSlot's evening branch announces a streak-card win via announceCard", async () => {
  const sent: { chatId: number | string; text?: string; caption?: string }[] = [];
  const tg = fakeTelegram({
    sendMessage: async (chatId: number | string, text: string) => {
      sent.push({ chatId, text });
    },
    sendPhoto: async (chatId: number | string, _filePath: string, caption: string) => {
      sent.push({ chatId, caption });
    },
  });
  const poller = new TelegramPoller(tg, 0);
  vi.spyOn(poller, "waitFor").mockResolvedValue(null); // no reply arrives — session/bonus round both time out

  const child = emptyChildProgress(333, "Тест", "2026-01-01");
  child.streak = 2; // finishDay() will bump this to 3 → STREAK_CARDS[3] ("Бронзовая лапка")
  const date = "2026-08-16";
  const day = getDay(child, date);
  day.sessions = 2; // dayParticipated() true without needing the bonus round
  day.cardsWon = ["placeholder"]; // non-empty — skips the bonus-round branch entirely

  await runChildSlot(poller, tg, child, date, "evening");

  expect(child.streak).toBe(3);
  expect(child.cards).toContain("s03");
  const announced = sent.find((m) => (m.text ?? m.caption ?? "").includes("Серия 3 дней"));
  expect(announced).toBeDefined();
  expect(announced?.chatId).toBe(333);
});
