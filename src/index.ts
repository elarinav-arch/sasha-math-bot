import { existsSync } from "node:fs";
import { allFacts } from "./facts.js";
import { localDate, weekStartFor } from "./calendar.js";
import { pickSessionFacts } from "./leitner.js";
import { teamReport } from "./report.js";
import {
  awardBonusCard, ensureCurrentWeek, finishDay, finishWeek, recordSession, rollSessionCard, starsForSession,
} from "./rewards.js";
import { rarityLabel, type Card } from "./cards.js";
import { tryJoin } from "./registration.js";
import { runSession } from "./session.js";
import {
  cardsWonToday, getDay, hasAttemptedSlot, loadTeamState, markSlotAttempted, saveTeamState,
  type ChildProgress, type TeamState,
} from "./state.js";
import { PolledIO, Telegram, TelegramPoller, type DeliveredMessage } from "./telegram.js";

export type Slot = "morning" | "midday" | "evening";

interface SlotWindow {
  slot: Slot;
  startMinutes: number; // от полуночи по кипрскому времени, включительно
  endMinutes: number; // исключительно
}

// Окна сплошные, без промежутков между ними: 14:00–17:00 / 17:00–19:00 / 19:00–22:00
// Кипр. GitHub Actions cron — best-effort и на практике срабатывает не по заданной
// частоте, а редко и нерегулярно (иногда раз в 1–3 часа, в произвольную минуту).
// Если бы между окнами были промежутки, редкое срабатывание могло попасть точно
// в промежуток и слот целиком пропадал бы (это и происходило). Сплошные окна
// гарантируют: любое срабатывание в течение дня попадёт хоть в какое-то окно.
const SLOT_SCHEDULE: SlotWindow[] = [
  { slot: "morning", startMinutes: 14 * 60, endMinutes: 17 * 60 },
  { slot: "midday", startMinutes: 17 * 60, endMinutes: 19 * 60 },
  { slot: "evening", startMinutes: 19 * 60, endMinutes: 22 * 60 }, // последнее — тут подводим итоги дня/недели
];

export function activeSlot(now: Date): Slot | null {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Nicosia",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  const minute = Number(parts.find((p) => p.type === "minute")!.value);
  const nowMinutes = hour * 60 + minute;
  const s = SLOT_SCHEDULE.find((w) => nowMinutes >= w.startMinutes && nowMinutes < w.endMinutes);
  return s ? s.slot : null;
}

const NEXT_TIME: Record<Slot, string> = {
  morning: "сегодня попозже 🕐",
  midday: "сегодня вечером 🌙",
  evening: "завтра 🌅",
};

const PROGRESS_PATH = "progress.json";
const QUESTIONS = 10;
const WINDOW_MINUTES = 60;
const BONUS_QUESTIONS = 5;
const BONUS_WINDOW_MINUTES = 20;

async function announceCard(tg: Telegram, chatId: number, card: Card, title: string): Promise<void> {
  const caption =
    `${title}\n${card.emoji} ${card.name}\nРедкость: ${rarityLabel(card.rarity)}` +
    (card.fact ? `\n\n${card.fact}` : "");
  const imagePath = `cards/${card.id}.png`;
  if (existsSync(imagePath)) await tg.sendPhoto(chatId, imagePath, caption);
  else await tg.sendMessage(chatId, `🃏 ${caption}`);
}

export async function runChildSlot(
  poller: TelegramPoller,
  tg: Telegram,
  child: ChildProgress,
  date: string,
  slot: Slot,
): Promise<void> {
  const io = new PolledIO(poller, child.chatId, Date.now() + WINDOW_MINUTES * 60_000);
  const facts = pickSessionFacts(child, allFacts(), QUESTIONS, new Date());
  const result = await runSession(io, child, facts);

  if (result.finished && result.answered > 0) {
    const stars = starsForSession(result.correct, result.answered);
    const dayAfter = recordSession(child, date, stars);
    await io.send(
      `🏁 Итог: ${result.correct} из ${result.answered} верно!\n` +
        `${"⭐".repeat(stars)} +${stars} (за день: ${dayAfter.stars} ⭐)\n` +
        `Следующая тренировка ${NEXT_TIME[slot]} 🐾`,
    );
    const wonCard = rollSessionCard(child, date, stars);
    if (wonCard) await announceCard(tg, child.chatId, wonCard, "🃏 Новая карточка за отличную тренировку!");
  } else if (!result.finished) {
    await tg.sendMessage(
      child.chatId,
      `Сегодня не вышло потренироваться — бывает! 🙂 Команда будет ждать ${NEXT_TIME[slot]} 🐾`,
    );
  }

  if (slot === "evening") {
    const day = getDay(child, date);
    if (cardsWonToday(day).length === 0) {
      await tg.sendMessage(
        child.chatId,
        `🎯 Бонусный раунд! Ещё ${BONUS_QUESTIONS} примеров — и карточка дня твоя, что бы ни было!`,
      );
      io.extendDeadline(BONUS_WINDOW_MINUTES * 60_000);
      const bonusFacts = pickSessionFacts(child, allFacts(), BONUS_QUESTIONS, new Date());
      const bonusResult = await runSession(io, child, bonusFacts);
      if (bonusResult.finished && bonusResult.answered > 0) {
        const bonusStars = starsForSession(bonusResult.correct, bonusResult.answered);
        recordSession(child, date, bonusStars);
        day.bonusRoundDone = true;
        await io.send(
          `🏁 Бонус завершён: ${bonusResult.correct} из ${bonusResult.answered} верно! ${"⭐".repeat(bonusStars)}`,
        );
        const bonusCard = awardBonusCard(child, date);
        if (bonusCard) await announceCard(tg, child.chatId, bonusCard, "🎉 Бонусная карточка — ты справилась!");
      }
    }
    const { streakCard } = finishDay(child, date);
    if (streakCard) await announceCard(tg, child.chatId, streakCard, `🔥 Серия ${child.streak} дней! Особая награда:`);
  }
}

// Оборачивает общий поллер: если он падает (сеть/API), не роняем весь процесс —
// просто прекращаем обработку /join и входящих ответов до конца этого запуска;
// уже идущие детские сессии сами уйдут по своему таймауту, а не зависнут.
export function runPoller(poller: TelegramPoller, onUnmatched: (msg: DeliveredMessage) => void): Promise<void> {
  return poller.run(onUnmatched).catch((err) => {
    console.error("TelegramPoller stopped unexpectedly (no more message delivery — replies or joins — for the rest of this run):", err);
  });
}

// Изолирует одного ребёнка: если его сессия падает, остальные дети в этом же
// запуске всё равно сохранят свой прогресс через saveTeamState в конце main().
export function runChildSlotSafely(
  poller: TelegramPoller,
  tg: Telegram,
  child: ChildProgress,
  date: string,
  slot: Slot,
): Promise<void> {
  return runChildSlot(poller, tg, child, date, slot).catch((err) => {
    console.error(`Session failed for child ${child.chatId} (${child.name}):`, err);
  });
}

async function handleUnmatched(team: TeamState, inviteCode: string, tg: Telegram, msg: DeliveredMessage): Promise<void> {
  const result = tryJoin(team, msg.text, inviteCode, msg.chatId, msg.fromName, new Date());
  if (result.kind === "welcome") {
    await tg.sendMessage(
      msg.chatId,
      `🐾 Добро пожаловать в команду, ${result.name}! Первая тренировка — на ближайшем окне (14:00 / 17:00 / 19:00 по Кипру).`,
    );
  } else if (result.kind === "already-member") {
    await tg.sendMessage(msg.chatId, "Ты уже в команде! 🐾 До следующей тренировки.");
  }
  // "wrong-code" — молчим: не подсказываем постороннему, что не так.
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const inviteCode = process.env.TEAM_INVITE_CODE;
  const parentChatId = process.env.PARENT_CHAT_ID ? Number(process.env.PARENT_CHAT_ID) : null;
  if (!token || !inviteCode) throw new Error("TELEGRAM_BOT_TOKEN and TEAM_INVITE_CODE are required");

  // Явный SESSION_SLOT (ручной запуск через workflow_dispatch) форсирует слот,
  // даже вне окна и даже если этот слот сегодня уже отмечен как проведённый.
  const slotEnv = process.env.SESSION_SLOT as Slot | undefined;
  const forced = Boolean(slotEnv);
  const slot: Slot | null = slotEnv || activeSlot(new Date());
  if (!slot) {
    console.log("Сейчас не окно тренировки — выхожу без действий.");
    return;
  }

  const date = localDate();
  const team = loadTeamState(PROGRESS_PATH);
  ensureCurrentWeek(team, weekStartFor(date));

  const tg = new Telegram(token);
  const poller = new TelegramPoller(tg);
  const pollerDone = runPoller(poller, (msg) => {
    void handleUnmatched(team, inviteCode, tg, msg);
  });

  const dueChildren = Object.values(team.children).filter((child) => {
    const day = getDay(child, date);
    if (!forced && hasAttemptedSlot(day, slot)) return false;
    markSlotAttempted(day, slot);
    return true;
  });

  await Promise.all(dueChildren.map((child) => runChildSlotSafely(poller, tg, child, date, slot)));

  if (slot === "evening" && team.lastEveningWrapUp !== date) {
    team.lastEveningWrapUp = date;
    const weekStart = weekStartFor(date);
    const isSunday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Nicosia", weekday: "short" }).format(new Date()) === "Sun";
    if (isSunday) {
      const { goalMet, trophyCard } = finishWeek(team, weekStart);
      const allChildren = Object.values(team.children);
      if (goalMet && trophyCard) {
        for (const child of allChildren) {
          await announceCard(tg, child.chatId, trophyCard, "🏆 Команда справилась на этой неделе!");
        }
      } else if (!goalMet && allChildren.length > 0) {
        for (const child of allChildren) {
          await tg.sendMessage(child.chatId, "Почти-почти! На следующей неделе команда точно справится 💪");
        }
      }
    }
    if (parentChatId) await tg.sendMessage(parentChatId, teamReport(team, date, weekStart));
  }

  poller.stop();
  await pollerDone;
  saveTeamState(PROGRESS_PATH, team);
}

// Запускаем main только при прямом старте (не при импорте из тестов)
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
