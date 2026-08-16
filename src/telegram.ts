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
