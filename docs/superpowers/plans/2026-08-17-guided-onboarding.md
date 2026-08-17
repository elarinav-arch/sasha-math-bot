# Диалог знакомства при регистрации — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить одношаговую команду `/join КОД` на диалог: приветствие с inline-кнопкой «Старт» → код-приглашение → бот спрашивает имя у ребёнка сам (вместо автоматического имени из Telegram-профиля).

**Architecture:** Telegram присылает нажатие inline-кнопки отдельным типом обновления (`callback_query`), которого сейчас в коде нет вообще. `dispatchUpdates` учится нормализовать `callback_query` в тот же `DeliveredMessage`, что и обычный текст — поэтому уже существующий и проверенный `TelegramPoller.waitFor` не меняется вообще, нажатие кнопки просто «приходит» как сообщение. Новая функция `runOnboarding` в `index.ts` ведёт диалог по шагам (`poller.send`/`poller.waitFor`), по образцу того, как `runChildSlot` уже ведёт тренировочную сессию.

**Tech Stack:** TypeScript + Node, vitest, тот же стек, что и весь остальной проект.

**Спека:** `docs/superpowers/specs/2026-08-17-guided-onboarding-design.md`

---

### Task 1: `dispatchUpdates` учится маршрутизировать нажатия кнопок (`callback_query`)

**Files:**
- Modify: `src/telegram.ts`
- Test: `tests/telegram.test.ts`

- [ ] **Step 1: Write the failing tests**

Добавь в `tests/telegram.test.ts` новый хелпер `cbUpd` (рядом с уже существующим `upd`) и 5 новых тестов:

```ts
// добавить рядом с существующей функцией upd(...)
function cbUpd(id: number, chatId: number, data?: string, firstName?: string): Update {
  return {
    update_id: id,
    callback_query: {
      id: `cb${id}`,
      data,
      from: firstName ? { first_name: firstName } : undefined,
      message: { chat: { id: chatId } },
    },
  };
}

test("dispatchUpdates delivers a callback_query's data as the message text", () => {
  const r = dispatchUpdates([cbUpd(20, 300, "start_onboarding", "Саша")], 0);
  expect(r.offset).toBe(21);
  expect(r.delivered).toEqual([{ chatId: 300, text: "start_onboarding", fromName: "Саша" }]);
});

test("dispatchUpdates routes a mixed batch of message and callback_query updates", () => {
  const updates = [upd(10, 100, "6", 1000, "Женя"), cbUpd(11, 200, "start_onboarding", "Саша")];
  const r = dispatchUpdates(updates, 0);
  expect(r.delivered).toEqual([
    { chatId: 100, text: "6", fromName: "Женя" },
    { chatId: 200, text: "start_onboarding", fromName: "Саша" },
  ]);
});

test("dispatchUpdates skips a callback_query with no data, offset still advances", () => {
  const r = dispatchUpdates([cbUpd(30, 400)], 0);
  expect(r.delivered).toEqual([]);
  expect(r.offset).toBe(31);
});

test("dispatchUpdates delivers only the first interaction per chat even across message/callback_query in one batch", () => {
  const updates = [cbUpd(40, 500, "start_onboarding"), upd(41, 500, "MURR2026", 1000)];
  const r = dispatchUpdates(updates, 0);
  expect(r.delivered).toEqual([{ chatId: 500, text: "start_onboarding", fromName: "друг" }]);
});

test("dispatchUpdates missing callback_query sender name falls back to a friendly default", () => {
  const r = dispatchUpdates([cbUpd(50, 600, "start_onboarding")], 0);
  expect(r.delivered[0].fromName).toBe("друг");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/telegram.test.ts`
Expected: FAIL — 5 new tests fail (assertion mismatches: `delivered` приходит пустым или без `callback_query`-полей, так как `Update`/`dispatchUpdates` ещё не знают о `callback_query`). Остальные 19 существующих тестов в файле продолжают проходить.

- [ ] **Step 3: Extend `Update` interface and `dispatchUpdates`**

В `src/telegram.ts` замени интерфейс `Update`:

```ts
export interface Update {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: { id: number };
    from?: { first_name?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: { first_name?: string };
    message?: { chat: { id: number } };
  };
}
```

И замени `dispatchUpdates`:

```ts
// Чистая функция: маршрутизирует пачку updates по разным чатам одновременно —
// не только один конкретный chatId, как раньше в nextReply, а сразу все.
// В пределах одной пачки от одного чата доставляется только первое сообщение
// (та же семантика, что была у nextReply — офсет всё равно продвигается за всю пачку).
// Нажатие inline-кнопки (callback_query) нормализуется в тот же DeliveredMessage,
// что и обычный текст — text становится данными кнопки (callback_data). Так
// TelegramPoller.waitFor не должен ничего знать про разницу между "написал"
// и "нажал кнопку" — это уже сделано на уровне диспетчеризации. У callback_query
// нет своего времени отправки (Telegram его не присылает), поэтому фильтр
// notBeforeMs к нему не применяется — нажатие кнопки всегда актуально.
export function dispatchUpdates(
  updates: Update[],
  notBeforeMs: number,
): { offset: number; delivered: DeliveredMessage[] } {
  let offset = 0;
  const seen = new Set<number>();
  const delivered: DeliveredMessage[] = [];
  for (const u of updates) {
    offset = Math.max(offset, u.update_id + 1);
    const m = u.message;
    if (m?.text && !seen.has(m.chat.id) && m.date * 1000 >= notBeforeMs) {
      seen.add(m.chat.id);
      delivered.push({ chatId: m.chat.id, text: m.text, fromName: m.from?.first_name ?? "друг" });
      continue;
    }
    const cq = u.callback_query;
    const cqChatId = cq?.message?.chat.id;
    if (cq?.data && cqChatId !== undefined && !seen.has(cqChatId)) {
      seen.add(cqChatId);
      delivered.push({ chatId: cqChatId, text: cq.data, fromName: cq.from?.first_name ?? "друг" });
    }
  }
  return { offset, delivered };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/telegram.test.ts`
Expected: 24 passed (19 существующих + 5 новых)

- [ ] **Step 5: Commit**

```bash
git add src/telegram.ts tests/telegram.test.ts
git commit -m "feat: dispatchUpdates routes callback_query button clicks as messages"
```

---

### Task 2: `Telegram.answerCallbackQuery` и `Telegram.sendMessageWithButton`

**Files:**
- Modify: `src/telegram.ts`

Это тонкие обёртки над HTTP-вызовом `this.call(...)` — как и существующие `sendMessage`/`sendPhoto`/`getUpdates`, они не покрыты юнит-тестами напрямую (во всех тестах `Telegram` подменяется фейковым объектом через `as unknown as Telegram`). Следуем этому же соглашению.

⚠️ **Обнаружено при ревью Task 1, добавлено сюда:** `Telegram.getUpdates` сейчас явно ограничивает `allowed_updates: ["message"]` — Telegram API интерпретирует это как "присылай мне ТОЛЬКО message", и без изменения этого списка `callback_query` от Telegram вообще никогда не придёт, сколько бы код ни был готов его обработать. Без этого шага вся фича молча не работала бы в проде (юнит-тесты этого не поймают — они всегда подставляют updates напрямую в фейковый `getUpdates`, минуя реальный список `allowed_updates`).

- [ ] **Step 1: Add the two methods to the `Telegram` class, and allow `callback_query` updates**

В `src/telegram.ts`, внутри класса `Telegram`, добавь после `sendPhoto`:

```ts
  async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackQueryId });
  }

  async sendMessageWithButton(
    chatId: number | string,
    text: string,
    buttonText: string,
    callbackData: string,
  ): Promise<void> {
    await this.call("sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: [[{ text: buttonText, callback_data: callbackData }]] },
    });
  }
```

И поменяй существующий метод `getUpdates` этого же класса — замени:
```ts
  getUpdates(offset: number, timeoutSec: number): Promise<Update[]> {
    return this.call("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message"] });
  }
```
на:
```ts
  getUpdates(offset: number, timeoutSec: number): Promise<Update[]> {
    return this.call("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] });
  }
```

- [ ] **Step 2: Verify the project still typechecks and all tests still pass**

Run: `npx tsc --noEmit && npx vitest run tests/telegram.test.ts`
Expected: `tsc` no output, vitest 24 passed (unchanged from Task 1 — this task only adds new methods and widens `allowed_updates`, doesn't touch anything existing that's under test)

- [ ] **Step 3: Commit**

```bash
git add src/telegram.ts
git commit -m "feat: Telegram.answerCallbackQuery and sendMessageWithButton"
```

---

### Task 3: `TelegramPoller.pollOnce` отвечает на нажатия кнопок

**Files:**
- Modify: `src/telegram.ts`
- Test: `tests/telegram.test.ts`

Без этого шага кнопка в Telegram-клиенте ребёнка будет вечно показывать «крутилку» после нажатия — Telegram требует явного `answerCallbackQuery` на каждый `callback_query`.

- [ ] **Step 1: Write the failing tests**

Добавь в `tests/telegram.test.ts`:

```ts
test("pollOnce answers a callback_query so the button stops showing a loading spinner", async () => {
  const answered: string[] = [];
  const tg = {
    getUpdates: async () => [cbUpd(1, 700, "start_onboarding")],
    answerCallbackQuery: async (id: string) => {
      answered.push(id);
    },
  } as unknown as Telegram;
  const poller = new TelegramPoller(tg, 0);
  await poller.pollOnce(() => {});
  expect(answered).toEqual(["cb1"]);
});

test("pollOnce answers every callback_query in a batch, even ones with no data", async () => {
  const answered: string[] = [];
  const tg = {
    getUpdates: async () => [cbUpd(1, 700), cbUpd(2, 800, "start_onboarding")],
    answerCallbackQuery: async (id: string) => {
      answered.push(id);
    },
  } as unknown as Telegram;
  const poller = new TelegramPoller(tg, 0);
  await poller.pollOnce(() => {});
  expect(answered).toEqual(["cb1", "cb2"]);
});

test("pollOnce does not throw if answerCallbackQuery fails — same defensive pattern as elsewhere in this file", async () => {
  const tg = {
    getUpdates: async () => [cbUpd(1, 700, "start_onboarding")],
    answerCallbackQuery: async () => {
      throw new Error("Telegram API error");
    },
  } as unknown as Telegram;
  const poller = new TelegramPoller(tg, 0);
  await expect(poller.pollOnce(() => {})).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/telegram.test.ts`
Expected: FAIL — 3 new tests fail (`tg.answerCallbackQuery` never called, `answered` stays `[]`; third test would actually still pass by accident since nothing throws yet — but write it now, it becomes a real regression guard once Step 3 lands). Остальные 24 теста проходят.

- [ ] **Step 3: Update `pollOnce`**

В `src/telegram.ts`, замени метод `pollOnce` класса `TelegramPoller`:

```ts
  async pollOnce(onUnmatched: (msg: DeliveredMessage) => void): Promise<void> {
    const updates = await this.tg.getUpdates(this.offset, 20);
    // Telegram требует явного ответа на КАЖДЫЙ callback_query, иначе кнопка у
    // ребёнка в клиенте вечно показывает "крутилку". await + .catch (а не
    // fire-and-forget) — тот же защитный паттерн, что и везде в этом файле:
    // необработанный reject здесь стал бы unhandled rejection и уронил бы
    // весь процесс (тот же класс бага, что уже чинили в runPoller/
    // runChildSlotSafely/handleUnmatchedSafely в index.ts).
    for (const u of updates) {
      if (u.callback_query) {
        await this.tg.answerCallbackQuery(u.callback_query.id).catch((err) => {
          console.error(`answerCallbackQuery failed for ${u.callback_query!.id}:`, err);
        });
      }
    }
    const { offset, delivered } = dispatchUpdates(updates, this.startedAtMs - 60_000);
    if (offset > this.offset) this.offset = offset;
    for (const msg of delivered) {
      const resolve = this.waiters.get(msg.chatId);
      if (resolve) {
        this.waiters.delete(msg.chatId);
        resolve(msg.text);
      } else {
        onUnmatched(msg);
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/telegram.test.ts`
Expected: 27 passed (24 + 3 новых)

- [ ] **Step 5: Commit**

```bash
git add src/telegram.ts tests/telegram.test.ts
git commit -m "feat: TelegramPoller answers callback_query updates"
```

---

### Task 4: `registration.ts` — `validateName` и `registerChild` вместо `tryJoin`

**Files:**
- Modify: `src/registration.ts` (полная замена)
- Modify: `tests/registration.test.ts` (полная замена)

⚠️ После этой задачи `src/index.ts` временно не типизируется (`tryJoin` больше не экспортируется, а `src/index.ts` его ещё импортирует) — это ожидаемо и чинится в Task 5. `tests/index.test.ts` тоже временно не сможет загрузиться (транзитивно импортирует `../src/index.js`), поэтому в Task 4 проверяем ТОЛЬКО `tests/registration.test.ts`, не полный набор.

- [ ] **Step 1: Write the failing tests — полная замена `tests/registration.test.ts`**

```ts
import { expect, test } from "vitest";
import { emptyTeamState } from "../src/state.js";
import { registerChild, validateName } from "../src/registration.js";

test("validateName trims surrounding whitespace", () => {
  expect(validateName("  Саша  ")).toBe("Саша");
});

test("validateName collapses repeated internal whitespace", () => {
  expect(validateName("Са   ша")).toBe("Са ша");
});

test("validateName rejects an empty string", () => {
  expect(validateName("")).toBeNull();
});

test("validateName rejects a whitespace-only string", () => {
  expect(validateName("   ")).toBeNull();
});

test("validateName accepts exactly 30 characters, rejects 31", () => {
  expect(validateName("a".repeat(30))).toBe("a".repeat(30));
  expect(validateName("a".repeat(31))).toBeNull();
});

test("registerChild creates a new ChildProgress keyed by chatId with the given name", () => {
  const team = emptyTeamState();
  const now = new Date("2026-08-17T12:00:00Z");
  registerChild(team, 100, "Саша", now);
  expect(team.children[100]).toEqual({
    chatId: 100, name: "Саша", joinedAt: now.toISOString(),
    facts: {}, days: [], streak: 0, cards: [], totalStars: 0,
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/registration.test.ts`
Expected: FAIL — `Cannot find module` или `validateName`/`registerChild` не экспортированы (`registration.js` всё ещё содержит только `tryJoin`)

- [ ] **Step 3: Полностью заменить `src/registration.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/registration.test.ts`
Expected: 6 passed

- [ ] **Step 5: Confirm the expected (temporary) breakage in index.ts, nothing else**

Run: `npx tsc --noEmit`
Expected: ровно одна ошибка — `src/index.ts`, `'tryJoin' is not exported from './registration.js'` (или аналогичная про несуществующий импорт). Никаких других ошибок. Это ожидаемо, чинится в Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/registration.ts tests/registration.test.ts
git commit -m "feat: validateName + registerChild replace tryJoin — child types their own name"
```

---

### Task 5: `runOnboarding` — диалог знакомства, подключение в `handleUnmatched`

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

Эта задача одним махом чинит временную поломку из Task 4 (меняет импорт в `index.ts`) и добавляет сам диалог. Разносить на более мелкие шаги нельзя: `tests/index.test.ts` транзитивно импортирует `../src/index.js`, и пока там висит нерабочий импорт `tryJoin`, файл теста вообще не загрузится — значит, чинить импорт и добавлять `runOnboarding` нужно за один коммит.

- [ ] **Step 1: Write the failing tests**

В `tests/index.test.ts`:
1. Добавь `runOnboarding` в импорт из `../src/index.js` (список станет: `activeSlot, handleUnmatchedSafely, runChildSlot, runChildSlotSafely, runEveningWrapUp, runOnboarding, runPoller`).
2. В хелпере `fakeTelegram` добавь `sendMessageWithButton: async () => {}` в объект дефолтов (рядом с уже существующими `getUpdates`/`sendMessage`/`sendPhoto`).
3. Замени существующий тест `"handleUnmatchedSafely absorbs a handleUnmatched rejection instead of leaving it to reject"` на:

```ts
test("handleUnmatchedSafely absorbs a handleUnmatched rejection instead of leaving it to reject", async () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const tg = fakeTelegram({
    sendMessageWithButton: async () => {
      throw new Error("Forbidden: bot was blocked by the user");
    },
  });
  const poller = new TelegramPoller(tg, 0);
  const team = emptyTeamState();
  const msg: DeliveredMessage = { chatId: 555, text: "/start", fromName: "Тест" };

  const result = handleUnmatchedSafely(team, "SASHA2026", tg, poller, msg);

  await expect(result).resolves.toBeUndefined();
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    "handleUnmatched failed for chatId 555:",
    expect.any(Error),
  );

  consoleErrorSpy.mockRestore();
});
```

(Сигнатура `handleUnmatchedSafely` меняется — раньше 4 аргумента, теперь 5, добавился `poller`. И теперь падает `sendMessageWithButton`, а не `sendMessage` — это первое, что реально вызывает новый диалог для незнакомого chatId.)

4. Добавь 8 новых тестов на `runOnboarding`:

```ts
test("runOnboarding walks a new child through button, code, and name to registration", async () => {
  const sent: string[] = [];
  let buttonSent: { text: string; buttonText: string; callbackData: string } | null = null;
  const tg = fakeTelegram({
    sendMessage: async (_chatId: number | string, text: string) => {
      sent.push(text);
    },
    sendMessageWithButton: async (
      _chatId: number | string,
      text: string,
      buttonText: string,
      callbackData: string,
    ) => {
      buttonSent = { text, buttonText, callbackData };
    },
  });
  const poller = new TelegramPoller(tg, 0);
  const waitForSpy = vi
    .spyOn(poller, "waitFor")
    .mockResolvedValueOnce("start_onboarding")
    .mockResolvedValueOnce("MURR2026")
    .mockResolvedValueOnce("Саша");
  const team = emptyTeamState();
  const now = () => new Date("2026-08-17T12:00:00Z");

  await runOnboarding(poller, tg, team, "MURR2026", 100, now);

  expect(buttonSent).not.toBeNull();
  expect(buttonSent!.callbackData).toBe("start_onboarding");
  expect(team.children[100]).toEqual({
    chatId: 100, name: "Саша", joinedAt: now().toISOString(),
    facts: {}, days: [], streak: 0, cards: [], totalStars: 0,
  });
  expect(sent.some((t) => t.includes("Приятно познакомиться, Саша"))).toBe(true);
  waitForSpy.mockRestore();
});

test("runOnboarding silently ends the dialog on a wrong code, nothing registered", async () => {
  const tg = fakeTelegram();
  const poller = new TelegramPoller(tg, 0);
  vi.spyOn(poller, "waitFor")
    .mockResolvedValueOnce("start_onboarding")
    .mockResolvedValueOnce("WRONG-CODE");
  const team = emptyTeamState();

  await runOnboarding(poller, tg, team, "MURR2026", 100);

  expect(team.children[100]).toBeUndefined();
});

test("runOnboarding ends silently if the button is never pressed in time", async () => {
  const tg = fakeTelegram();
  const poller = new TelegramPoller(tg, 0);
  vi.spyOn(poller, "waitFor").mockResolvedValueOnce(null);
  const team = emptyTeamState();

  await runOnboarding(poller, tg, team, "MURR2026", 100);

  expect(team.children[100]).toBeUndefined();
});

test("runOnboarding ends silently if no code arrives in time after the button is pressed", async () => {
  const tg = fakeTelegram();
  const poller = new TelegramPoller(tg, 0);
  vi.spyOn(poller, "waitFor")
    .mockResolvedValueOnce("start_onboarding")
    .mockResolvedValueOnce(null);
  const team = emptyTeamState();

  await runOnboarding(poller, tg, team, "MURR2026", 500);

  expect(team.children[500]).toBeUndefined();
});

test("runOnboarding re-prompts once for an invalid name, then registers on a valid retry", async () => {
  const sent: string[] = [];
  const tg = fakeTelegram({
    sendMessage: async (_chatId: number | string, text: string) => {
      sent.push(text);
    },
  });
  const poller = new TelegramPoller(tg, 0);
  vi.spyOn(poller, "waitFor")
    .mockResolvedValueOnce("start_onboarding")
    .mockResolvedValueOnce("MURR2026")
    .mockResolvedValueOnce("   ")
    .mockResolvedValueOnce("Женя");
  const team = emptyTeamState();

  await runOnboarding(poller, tg, team, "MURR2026", 200);

  expect(team.children[200]?.name).toBe("Женя");
  expect(sent.some((t) => t.includes("попробуй короче"))).toBe(true);
});

test("runOnboarding gives up silently after a second invalid name", async () => {
  const tg = fakeTelegram();
  const poller = new TelegramPoller(tg, 0);
  vi.spyOn(poller, "waitFor")
    .mockResolvedValueOnce("start_onboarding")
    .mockResolvedValueOnce("MURR2026")
    .mockResolvedValueOnce("")
    .mockResolvedValueOnce("a".repeat(31));
  const team = emptyTeamState();

  await runOnboarding(poller, tg, team, "MURR2026", 300);

  expect(team.children[300]).toBeUndefined();
});

test("runOnboarding skips the whole dialog for an already-registered chatId", async () => {
  const sent: string[] = [];
  const tg = fakeTelegram({
    sendMessage: async (_chatId: number | string, text: string) => {
      sent.push(text);
    },
  });
  const poller = new TelegramPoller(tg, 0);
  const waitForSpy = vi.spyOn(poller, "waitFor");
  const team = emptyTeamState();
  team.children[400] = emptyChildProgress(400, "Саша", "2026-01-01");

  await runOnboarding(poller, tg, team, "MURR2026", 400);

  expect(waitForSpy).not.toHaveBeenCalled();
  expect(sent).toEqual(["Ты уже в команде! 🐾 До следующей тренировки."]);
});

test("runOnboarding trims surrounding whitespace from the code before comparing", async () => {
  const tg = fakeTelegram();
  const poller = new TelegramPoller(tg, 0);
  vi.spyOn(poller, "waitFor")
    .mockResolvedValueOnce("start_onboarding")
    .mockResolvedValueOnce("  MURR2026  ")
    .mockResolvedValueOnce("Саша");
  const team = emptyTeamState();

  await runOnboarding(poller, tg, team, "MURR2026", 600);

  expect(team.children[600]?.name).toBe("Саша");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/index.test.ts`
Expected: FAIL — файл вообще не загружается (`tryJoin` не экспортируется из `registration.js`, импорт в `index.ts` невалиден). Это ожидаемое красное состояние — Step 3 его чинит.

- [ ] **Step 3: Update `src/index.ts`**

Замени строку импорта:
```ts
import { tryJoin } from "./registration.js";
```
на:
```ts
import { registerChild, validateName } from "./registration.js";
```

Добавь новые константы рядом с существующими (`PROGRESS_PATH`, `QUESTIONS`, `WINDOW_MINUTES` и т.д.):
```ts
const ONBOARDING_STEP_MINUTES = 5;
const START_CALLBACK_DATA = "start_onboarding";
```

Добавь новую функцию `runOnboarding` (например, сразу после `runChildSlotSafely`, перед `handleUnmatched`):

```ts
// Диалог знакомства для НЕзарегистрированного chatId: приветствие с кнопкой →
// код-приглашение → имя → профиль создан. Каждый шаг ждёт ответа тем же
// waitFor, что и обычные тренировочные сессии (см. PolledIO) — просто без
// PolledIO, так как здесь не нужен единый "плавающий" дедлайн, у каждого шага
// свой фиксированный таймаут. Неверный код или дважды невалидное имя —
// диалог тихо завершается: тот же принцип, что был у /join — не подсказываем
// постороннему, что именно не так.
export async function runOnboarding(
  poller: TelegramPoller,
  tg: Telegram,
  team: TeamState,
  inviteCode: string,
  chatId: number,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (team.children[chatId]) {
    await tg.sendMessage(chatId, "Ты уже в команде! 🐾 До следующей тренировки.");
    return;
  }

  await tg.sendMessageWithButton(
    chatId,
    "🐱 Привет! Я бот «Мур-математика» — помогаю тренировать таблицу умножения и собирать карточки с котиками. Готов(а) начать?",
    "🐾 Старт",
    START_CALLBACK_DATA,
  );
  const started = await poller.waitFor(chatId, ONBOARDING_STEP_MINUTES * 60_000);
  if (started !== START_CALLBACK_DATA) return;

  await tg.sendMessage(chatId, "Отлично! Введи код-приглашения, который тебе дали:");
  const code = await poller.waitFor(chatId, ONBOARDING_STEP_MINUTES * 60_000);
  if (code === null || code.trim() !== inviteCode) return;

  await tg.sendMessage(chatId, "Ура, код верный! 🎉 А как тебя зовут?");
  let name: string | null = null;
  for (let attempt = 0; attempt < 2 && name === null; attempt++) {
    const reply = await poller.waitFor(chatId, ONBOARDING_STEP_MINUTES * 60_000);
    if (reply === null) return;
    name = validateName(reply);
    if (name === null && attempt === 0) {
      await tg.sendMessage(chatId, "Хм, попробуй короче и без лишнего, например «Саша» 🙂");
    }
  }
  if (name === null) return;

  registerChild(team, chatId, name, now());
  await tg.sendMessage(
    chatId,
    `Приятно познакомиться, ${name}! 🐾 Ты в команде «Мур-математика». Первая тренировка — на ближайшем окне (14:00 / 17:00 / 19:00 по Кипру).`,
  );
}
```

Замени `handleUnmatched`:

```ts
async function handleUnmatched(
  team: TeamState,
  inviteCode: string,
  tg: Telegram,
  poller: TelegramPoller,
  msg: DeliveredMessage,
): Promise<void> {
  await runOnboarding(poller, tg, team, inviteCode, msg.chatId);
}
```

Замени `handleUnmatchedSafely`:

```ts
export function handleUnmatchedSafely(
  team: TeamState,
  inviteCode: string,
  tg: Telegram,
  poller: TelegramPoller,
  msg: DeliveredMessage,
): Promise<void> {
  return handleUnmatched(team, inviteCode, tg, poller, msg).catch((err) => {
    console.error(`handleUnmatched failed for chatId ${msg.chatId}:`, err);
  });
}
```

В `main()`, обнови вызов `handleUnmatchedSafely` (добавь `poller` четвёртым аргументом):

```ts
  const pollerDone = runPoller(poller, (msg) => {
    void handleUnmatchedSafely(team, inviteCode, tg, poller, msg);
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/index.test.ts`
Expected: 16 passed (8 существующих, один из них изменён, + 8 новых)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test 2>&1 | tail -25 && npm run typecheck 2>&1 | tail -10`
Expected: все файлы проходят, `tsc --noEmit` — без вывода. (Это первая точка с Task 4, где ПОЛНЫЙ набор снова компилируется и проходит — временная поломка `index.ts` из Task 4 полностью устранена.)

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: runOnboarding — greeting button, invite code, child types their own name

Заменяет одношаговый /join КОД: приветствие с inline-кнопкой «Старт» →
код-приглашение → бот сам спрашивает имя вместо автоматического
Telegram first_name. Использует уже существующий TelegramPoller.waitFor
без изменений — нажатие кнопки нормализуется в dispatchUpdates (Task 1)
в тот же DeliveredMessage, что и обычный текст."
```

---

### Task 6: Обновить README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the registration description in the "Настройка" section**

В `README.md`, замени строки 18–22 (шаг 5, "Командный режим"):

```markdown
5. **Командный режим:** придумайте код-приглашение (любая строка без пробелов,
   например `MURR2026`) и добавьте его как секрет `TEAM_INVITE_CODE`. Дети
   присоединяются, написав боту `/join КОД` со своего аккаунта — секрет
   `CHILD_CHAT_ID` больше не используется (Александра уже добавлена в команду
   через `scripts/migrate-to-team.ts`, остальным просто дайте код).
```

на:

```markdown
5. **Командный режим:** придумайте код-приглашение (любая строка без пробелов,
   например `MURR2026`) и добавьте его как секрет `TEAM_INVITE_CODE`. Дети
   присоединяются сами: пишут боту что угодно со своего аккаунта (например
   `/start`) — бот поздоровается, покажет кнопку «Старт», спросит код и
   имя. Секрет `CHILD_CHAT_ID` не используется (Александра уже в команде
   через `scripts/migrate-to-team.ts`, остальным просто дайте код).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: описать новый диалог регистрации вместо /join КОД"
```

---

### Task 7: Финальная проверка

**Files:** нет (только верификация)

- [ ] **Step 1: Full test suite and typecheck**

Run: `npm test 2>&1 | tail -30 && npm run typecheck 2>&1 | tail -20`
Expected: 137 passed (14 test files) — было 120 (telegram.test.ts 19, registration.test.ts 5, index.test.ts 8, остальные файлы 88), этот план добавляет: telegram.test.ts 19→27 (Task 1 +5, Task 3 +3), registration.test.ts 5→6 (полная замена: −5 старых на tryJoin, +6 новых), index.test.ts 8→16 (Task 5 +8, один существующий тест изменён на месте). `tsc --noEmit` — без вывода.

- [ ] **Step 2: Grep for any remaining references to the retired `tryJoin`/`/join`**

Run: `grep -rn "tryJoin\|/join" src/ tests/ README.md`
Expected: без совпадений (кроме, возможно, `.github/workflows/train.yml`, если там где-то упоминается — проверить руками и убрать, если найдётся; в остальных местах хит означает, что что-то забыли обновить)

- [ ] **Step 3: Manual note (not automated) — first message a parent sends via /start**

Не задача для кода: README (шаг 2, "Chat ID") просит родителя написать боту `/start`, чтобы узнать `PARENT_CHAT_ID` через сырой `getUpdates`. После этого плана ЛЮБОЕ первое сообщение от незнакомого chatId (в том числе `/start` от родителя, если бот в этот момент активен) запускает диалог знакомства — родитель увидит приветствие с кнопкой. Это не ошибка и ничего не ломает (родитель просто не обязан на неё жать), но стоит иметь в виду и, если будет мешать, — обсудить отдельно после того, как эта фича будет в проде.
