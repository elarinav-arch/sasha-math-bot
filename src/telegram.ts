import { readFileSync } from "node:fs";

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

export interface DeliveredMessage {
  chatId: number;
  text: string;
  fromName: string;
}

// Чистая функция: маршрутизирует пачку updates по разным чатам одновременно —
// не только один конкретный chatId, как раньше в nextReply, а сразу все.
// В пределах одной пачки от одного чата доставляется только первое сообщение
// (та же семантика, что была у nextReply — офсет всё равно продвигается за всю пачку).
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
    if (!m?.text || seen.has(m.chat.id)) continue;
    if (m.date * 1000 < notBeforeMs) continue; // старое сообщение из очереди вне окна
    seen.add(m.chat.id);
    delivered.push({ chatId: m.chat.id, text: m.text, fromName: m.from?.first_name ?? "друг" });
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

  constructor(
    private tg: Telegram,
    private startedAtMs: number = Date.now(),
  ) {}

  async pollOnce(onUnmatched: (msg: DeliveredMessage) => void): Promise<void> {
    const updates = await this.tg.getUpdates(this.offset, 20);
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
    while (!this.stopped) await this.pollOnce(onUnmatched);
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
