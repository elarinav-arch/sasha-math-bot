import { expect, test, vi } from "vitest";
import {
  activeSlot, handleUnmatchedSafely, runChildSlot, runChildSlotSafely, runEveningWrapUp, runPoller,
} from "../src/index.js";
import { TelegramPoller, type DeliveredMessage, type Telegram } from "../src/telegram.js";
import { emptyChildProgress, emptyTeamState, getDay } from "../src/state.js";

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

// Fix 1: runPoller(...) — a poller failure must never surface as an unhandled rejection;
// it must resolve to a settled (non-rejecting) promise once caught, exactly the real
// helper main() calls (not a hand-copied .catch snippet).
test("runPoller absorbs a TelegramPoller.run() rejection instead of leaving it to reject", async () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const tg = fakeTelegram({
    getUpdates: async () => {
      throw new Error("network hiccup");
    },
  });
  const poller = new TelegramPoller(tg, 0);

  const pollerDone = runPoller(poller, () => {});

  await expect(pollerDone).resolves.toBeUndefined();
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    "TelegramPoller stopped unexpectedly (no more message delivery — replies or joins — for the rest of this run):",
    expect.any(Error),
  );

  consoleErrorSpy.mockRestore();
});

// Fix 1 (recurring): handleUnmatchedSafely wraps the same fire-and-forget dispatch main()
// hands to runPoller's onUnmatched callback with its own .catch, so a failure inside
// handleUnmatched (e.g. tg.sendMessage rejecting for a blocked/stale chat) can't become an
// unhandled rejection and crash the whole process mid-run. Calls the real helper main() uses.
test("handleUnmatchedSafely absorbs a handleUnmatched rejection instead of leaving it to reject", async () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const tg = fakeTelegram({
    sendMessage: async () => {
      throw new Error("Forbidden: bot was blocked by the user");
    },
  });
  const team = emptyTeamState();
  const msg: DeliveredMessage = { chatId: 555, text: "/join SASHA2026", fromName: "Тест" };

  const result = handleUnmatchedSafely(team, "SASHA2026", tg, msg);

  await expect(result).resolves.toBeUndefined();
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    "handleUnmatched failed for chatId 555:",
    expect.any(Error),
  );

  consoleErrorSpy.mockRestore();
});

// Fix 2: runChildSlotSafely(...) wraps each child's session with its own .catch so one
// child's thrown error can't reject the whole Promise.all batch and wipe out siblings'
// already-completed progress. Calls the real helper main() calls, not a copy.
test("runChildSlotSafely isolates one child's rejection so siblings still settle", async () => {
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

  // Same shape main() uses: Promise.all(dueChildren.map((child) => runChildSlotSafely(...)))
  await Promise.all(
    [childA, childB].map((child) => runChildSlotSafely(poller, tg, child, date, "morning")),
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

// Fix 2 (recurring): the Sunday evening trophy/consolation loop and the parent-report send
// had no per-send error isolation, so one child's failed send (stale/blocked chat) would
// throw out of main() before poller.stop()/saveTeamState() ran — discarding the WHOLE run's
// progress for every child, not just the one whose send failed. Each send must be isolated
// so the loop reaches every remaining child. Calls the real helper main() calls.
test("runEveningWrapUp isolates one child's send failure so the loop reaches the next child", async () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const sentTo: (number | string)[] = [];
  const tg = fakeTelegram({
    sendMessage: async (chatId: number | string) => {
      if (chatId === 111) throw new Error("Forbidden: bot was blocked by the user");
      sentTo.push(chatId);
    },
  });
  const team = emptyTeamState();
  team.children[111] = emptyChildProgress(111, "A", "2026-01-01");
  team.children[222] = emptyChildProgress(222, "B", "2026-01-01");
  // Neither child has any day records, so finishWeek() reports goalMet === false and
  // both children fall into the consolation-message loop (the branch under test).

  await runEveningWrapUp(tg, team, "2026-08-16", "2026-08-10", true, null);

  expect(consoleErrorSpy).toHaveBeenCalledWith(
    "Consolation message failed for chatId 111:",
    expect.any(Error),
  );
  expect(sentTo).toContain(222); // sibling B still got the message despite A's send failing

  consoleErrorSpy.mockRestore();
});

// Same failure class as above, but for the parent team-report send specifically: it must
// not throw out of runEveningWrapUp (which would still abort main() before saveTeamState()).
test("runEveningWrapUp isolates a failed parent report send instead of throwing", async () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const tg = fakeTelegram({
    sendMessage: async () => {
      throw new Error("Forbidden: bot was blocked by the user");
    },
  });
  const team = emptyTeamState();

  await expect(
    runEveningWrapUp(tg, team, "2026-08-16", "2026-08-10", false, 999),
  ).resolves.toBeUndefined();

  expect(consoleErrorSpy).toHaveBeenCalledWith("Team report send to parent failed:", expect.any(Error));

  consoleErrorSpy.mockRestore();
});
