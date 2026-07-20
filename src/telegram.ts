import { readFileSync } from "node:fs";
import type { SessionIO } from "./session.js";

const API = "https://api.telegram.org";

export interface Update {
  update_id: number;
  message?: { message_id: number; date: number; text?: string; chat: { id: number } };
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

  getUpdates(offset: number, timeoutSec: number): Promise<Update[]> {
    return this.call("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message"] });
  }
}

// Чистая функция: первое подходящее текстовое сообщение из пачки updates
export function nextReply(
  updates: Update[],
  chatId: number,
  notBeforeMs: number,
): { text: string | null; offset: number } {
  let offset = 0;
  let text: string | null = null;
  for (const u of updates) {
    offset = Math.max(offset, u.update_id + 1);
    if (text !== null) continue;
    const m = u.message;
    if (!m || m.chat.id !== chatId || !m.text) continue;
    if (m.date * 1000 < notBeforeMs) continue; // старое сообщение из очереди вне окна
    text = m.text;
  }
  return { text, offset };
}

export class TelegramIO implements SessionIO {
  private offset = 0;

  constructor(
    private tg: Telegram,
    private chatId: number,
    private startedAtMs: number,
    private deadlineMs: number,
  ) {}

  async send(text: string): Promise<void> {
    await this.tg.sendMessage(this.chatId, text);
  }

  // Продлевает окно ожидания ответов (например, для бонусного раунда после основной сессии).
  // Отсчёт — от текущего момента, а не от старого дедлайна: иначе итоговое окно
  // зависело бы от того, сколько времени уже прошло с начала исходной сессии.
  extendDeadline(extraMs: number): void {
    this.deadlineMs = Date.now() + extraMs;
  }

  async waitForReply(timeoutMs: number): Promise<string | null> {
    const until = Math.min(Date.now() + timeoutMs, this.deadlineMs);
    while (Date.now() < until) {
      const sec = Math.max(1, Math.min(50, Math.ceil((until - Date.now()) / 1000)));
      const updates = await this.tg.getUpdates(this.offset, sec);
      const r = nextReply(updates, this.chatId, this.startedAtMs - 60_000);
      if (r.offset > this.offset) this.offset = r.offset;
      if (r.text !== null) return r.text;
    }
    return null;
  }
}
