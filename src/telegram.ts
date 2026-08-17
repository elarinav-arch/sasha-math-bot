import { readFileSync } from "node:fs";
import type { SessionIO } from "./session.js";

const API = "https://api.telegram.org";

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

export class Telegram {
  constructor(private token: string) {}

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${API}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
    return data.result;
  }

  async sendMessage(chatId: number | string, text: string): Promise<void> {
    await this.call("sendMessage", { chat_id: chatId, text });
  }

  async sendPhoto(chatId: number | string, filePath: string, caption: string): Promise<void> {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("photo", new Blob([readFileSync(filePath)]), "card.png");
    const res = await fetch(`${API}/bot${this.token}/sendPhoto`, { method: "POST", body: form });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) throw new Error(`Telegram sendPhoto: ${data.description}`);
  }

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

  getUpdates(offset: number, timeoutSec: number): Promise<Update[]> {
    return this.call("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] });
  }
}

export interface DeliveredMessage {
  chatId: number;
  text: string;
  fromName: string;
}

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

// Единственный объект за весь запуск джобы, который реально вызывает getUpdates.
// Telegram даёт long-polling offset НА ВЕСЬ БОТ, а не на пользователя — если бы
// каждая детская сессия сама опрашивала Telegram, они бы путали друг другу offset.
// Вместо этого сессии регистрируют ожидание через waitFor(chatId, ...), а поллер
// раздаёт пришедшие сообщения нужным ожидающим (см. PolledIO — тонкая обёртка
// вокруг этого класса, реализующая интерфейс SessionIO для одного ребёнка).
export class TelegramPoller {
  private offset = 0;
  private waiters = new Map<number, (text: string) => void>();
  private stopped = false;
  private currentCycle: Promise<void> = Promise.resolve();

  constructor(
    private tg: Telegram,
    private startedAtMs: number = Date.now(),
  ) {}

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

  async run(onUnmatched: (msg: DeliveredMessage) => void): Promise<void> {
    while (!this.stopped) {
      this.currentCycle = this.pollOnce(onUnmatched);
      await this.currentCycle;
    }
  }

  // Дожидается завершения ТЕКУЩЕГО (или ещё не начавшегося, но уже запланированного)
  // цикла опроса. Нужно перед остановкой поллера: onboarding.pending синхронно
  // пополняется ВНУТРИ pollOnce (см. onUnmatched), поэтому проверка "pending
  // пуст ли" сама по себе не различает "точно нечего ждать" и "ещё не успели
  // получить самое первое сообщение этого запуска". Дав текущему циклу
  // завершиться, мы гарантируем: если что-то пришло — оно уже зарегистрировано
  // в onboarding.pending к моменту вызова waitForAll().
  waitForCurrentCycle(): Promise<void> {
    return this.currentCycle;
  }

  stop(): void {
    this.stopped = true;
  }

  waitFor(chatId: number, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      const onMessage = (text: string) => {
        clearTimeout(timer);
        resolve(text);
      };
      const timer = setTimeout(() => {
        if (this.waiters.get(chatId) === onMessage) this.waiters.delete(chatId);
        resolve(null);
      }, timeoutMs);
      this.waiters.set(chatId, onMessage);
    });
  }

  send(chatId: number, text: string): Promise<void> {
    return this.tg.sendMessage(chatId, text);
  }
}

// Реализация SessionIO для ОДНОГО ребёнка поверх общего TelegramPoller — сама
// не опрашивает Telegram, а просто регистрирует ожидание у поллера.
export class PolledIO implements SessionIO {
  private deadlineMs: number;

  constructor(
    private poller: TelegramPoller,
    private chatId: number,
    deadlineMs: number,
  ) {
    this.deadlineMs = deadlineMs;
  }

  send(text: string): Promise<void> {
    return this.poller.send(this.chatId, text);
  }

  extendDeadline(extraMs: number): void {
    this.deadlineMs = Date.now() + extraMs;
  }

  async waitForReply(timeoutMs: number): Promise<string | null> {
    const remaining = Math.min(timeoutMs, this.deadlineMs - Date.now());
    if (remaining <= 0) return null;
    return this.poller.waitFor(this.chatId, remaining);
  }
}
