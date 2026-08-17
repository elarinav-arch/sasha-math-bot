import { existsSync } from "node:fs";
import { allFacts } from "./facts.js";
import { localDate, weekStartFor } from "./calendar.js";
import { pickSessionFacts } from "./leitner.js";
import { teamReport } from "./report.js";
import {
  awardBonusCard, ensureCurrentWeek, finishDay, finishWeek, recordSession, rollSessionCard, starsForSession,
} from "./rewards.js";
import { rarityLabel, type Card } from "./cards.js";
import { registerChild, validateName } from "./registration.js";
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
const ONBOARDING_STEP_MINUTES = 5;
const START_CALLBACK_DATA = "start_onboarding";

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
// просто прекращаем обработку регистрации и входящих ответов до конца этого запуска;
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

// Отслеживает диалоги регистрации, которые идут прямо сейчас (по chatId), чтобы:
// 1) не запускать два диалога для одного chatId параллельно — если ребёнок
//    пришлёт два сообщения подряд до первого шага своего диалога, второе
//    просто игнорируется, а не порождает дублирующееся приветствие;
// 2) main() мог дождаться завершения ВСЕХ идущих диалогов регистрации перед
//    остановкой поллера — иначе, если в этот слот больше никто не тренируется,
//    poller.stop() сработает почти сразу после старта джобы и оборвёт диалог,
//    даже не успев получить от ребёнка ответ на первое же сообщение.
export class OnboardingTracker {
  private pending = new Map<number, Promise<void>>();

  start(chatId: number, run: () => Promise<void>): void {
    if (this.pending.has(chatId)) return;
    const p = run().finally(() => this.pending.delete(chatId));
    this.pending.set(chatId, p);
  }

  async waitForAll(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all(this.pending.values());
    }
  }
}

async function handleUnmatched(
  team: TeamState,
  inviteCode: string,
  tg: Telegram,
  poller: TelegramPoller,
  msg: DeliveredMessage,
): Promise<void> {
  await runOnboarding(poller, tg, team, inviteCode, msg.chatId);
}

// Изолирует handleUnmatched: он вызывается синхронно, фоново, из поллера
// (onUnmatched не await-ится внутри pollOnce), поэтому падение (например,
// sendMessage отклонённому/заблокированному боту) без собственного .catch
// становится unhandled rejection и роняет весь процесс — та же природа бага,
// что уже была исправлена в runPoller/runChildSlotSafely.
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

// Итоги вечера воскресенья (трофей/утешение) и отчёт родителю. Каждая отправка
// изолирована собственным .catch: одно неотвечающее/заблокированное чат-окно
// (ребёнок или родитель) не должно прерывать рассылку остальным и не должно
// пробрасывать исключение наружу — иначе main() упадёт до poller.stop()/
// saveTeamState() и потеряет прогресс ВСЕХ детей за этот запуск, а не только
// того, чья отправка не удалась. Та же причина бага, что и в runChildSlotSafely.
export async function runEveningWrapUp(
  tg: Telegram,
  team: TeamState,
  date: string,
  weekStart: string,
  isSunday: boolean,
  parentChatId: number | null,
): Promise<void> {
  if (isSunday) {
    const { goalMet, trophyCard } = finishWeek(team, weekStart);
    const allChildren = Object.values(team.children);
    if (goalMet && trophyCard) {
      for (const child of allChildren) {
        await announceCard(tg, child.chatId, trophyCard, "🏆 Команда справилась на этой неделе!").catch((err) => {
          console.error(`Trophy announcement failed for chatId ${child.chatId}:`, err);
        });
      }
    } else if (!goalMet && allChildren.length > 0) {
      for (const child of allChildren) {
        await tg.sendMessage(child.chatId, "Почти-почти! На следующей неделе команда точно справится 💪").catch((err) => {
          console.error(`Consolation message failed for chatId ${child.chatId}:`, err);
        });
      }
    }
  }
  if (parentChatId) {
    await tg.sendMessage(parentChatId, teamReport(team, date, weekStart)).catch((err) => {
      console.error("Team report send to parent failed:", err);
    });
  }
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
  const onboarding = new OnboardingTracker();
  const pollerDone = runPoller(poller, (msg) => {
    onboarding.start(msg.chatId, () => handleUnmatchedSafely(team, inviteCode, tg, poller, msg));
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
    await runEveningWrapUp(tg, team, date, weekStart, isSunday, parentChatId);
  }

  // Ждём текущий цикл опроса, прежде чем проверять onboarding.waitForAll() —
  // иначе, если этот запуск не тренирует ни одного уже зарегистрированного
  // ребёнка (dueChildren пуст — обычное дело на резервных тиках cron), можно
  // дойти досюда быстрее, чем поллер успеет получить самое первое сообщение
  // нового ребёнка, и остановить поллер до того, как диалог знакомства вообще
  // успеет начаться.
  await poller.waitForCurrentCycle();
  await onboarding.waitForAll();

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
