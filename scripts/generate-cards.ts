// Одноразовый скрипт: генерирует PNG-картинки для всех карточек через Gemini.
// Запуск: положи GEMINI_API_KEY в .env (или в окружение) и выполни
//   npx tsx scripts/generate-cards.ts
// Уже существующие cards/<id>.png пропускаются — можно перезапускать безопасно.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { CARDS, STREAK_CARDS, type Card } from "../src/cards.js";

const IMAGE_MODELS = ["gemini-2.5-flash-image", "gemini-3.1-flash-image"];

function loadEnvKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (existsSync(".env")) {
    const line = readFileSync(".env", "utf8")
      .split("\n")
      .find((l) => l.startsWith("GEMINI_API_KEY="));
    if (line) return line.slice("GEMINI_API_KEY=".length).trim();
  }
  throw new Error("GEMINI_API_KEY не найден: добавь его в .env или в окружение");
}

// Разные позы для визуального разнообразия коллекции — без этого все 60 карточек
// выглядели бы как один и тот же "сидящий котик" в разных мастях.
const POSES = [
  "sitting upright, looking curiously at the camera",
  "playful pose lying on its back with paws in the air, head tilted",
  "mid-pounce, playful jumping pose, one paw raised",
  "curled up sleepy in a cozy ball, eyes half-closed",
  "stretching forward with front paws extended, back gently arched",
  "walking pose, one paw lifted mid-step, tail up",
  "peeking curiously from behind a soft blanket fold",
  "sitting with one paw raised, as if waving hello",
  "lying on its belly, front paws tucked in, alert expression",
  "playfully batting at something just out of frame, one paw extended",
];

function poseFor(card: Card, index: number): string {
  return POSES[index % POSES.length];
}

// Карточки за серию дней — не порода, а тематический "бейдж" под их новые названия
// (Бронзовая лапка / Серебряный бантик / Золотые усы / Бриллиантовый хвост).
const STREAK_PROMPTS: Record<string, string> = {
  s03:
    "Extremely adorable high-quality realistic close-up photo of a cute cat's single front paw " +
    "with soft bronze-toned lighting, resting on a cozy blanket, shallow depth of field, square " +
    "format, gentle rounded card-like framing. No text, no letters, no numbers on the image.",
  s07:
    "Extremely adorable high-quality realistic photo of a cute kitten wearing a small silver satin " +
    "bow around its neck, sitting proudly, soft silvery lighting, cozy blurred background, square " +
    "format, gentle rounded card-like framing. No text, no letters on the image.",
  s14:
    "Extremely adorable high-quality realistic close-up photo of a cute cat's face, focus on its " +
    "long elegant whiskers catching warm golden-hour light, soft golden lighting, cozy blurred " +
    "background, square format, gentle rounded card-like framing. No text, no letters on the image.",
  s30:
    "Extremely adorable high-quality realistic photo of a fluffy cat's tail curled elegantly, with " +
    "soft sparkly diamond-like light particles in the air around it, cool blue-white lighting, cozy " +
    "blurred background, square format, gentle rounded card-like framing. No text on the image.",
};

function prompt(card: Card, index: number): string {
  if (STREAK_PROMPTS[card.id]) return STREAK_PROMPTS[card.id];
  return (
    `Extremely adorable high-quality realistic photo of a ${card.name} cat/kitten, ` +
    `${poseFor(card, index)}. Big expressive eyes, soft natural window light, cozy blurred ` +
    `background, close-up professional pet photography style, square format, gentle rounded ` +
    `card-like framing, maximum cuteness. No text, no letters on the image.`
  );
}

async function generate(ai: GoogleGenAI, card: Card, index: number): Promise<Buffer | null> {
  for (const model of IMAGE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt(card, index),
        config: { responseModalities: ["TEXT", "IMAGE"] },
      });
      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        const data = (part as { inlineData?: { data?: string } }).inlineData?.data;
        if (data) return Buffer.from(data, "base64");
      }
      console.warn(`  ${model}: картинки в ответе нет, пробую следующую модель`);
    } catch (err) {
      console.error(`  ${model}: ${(err as Error).message}`);
    }
  }
  return null;
}

async function main(): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: loadEnvKey() });
  mkdirSync("cards", { recursive: true });
  const all = [...CARDS, ...Object.values(STREAK_CARDS)];
  const limit = process.argv[2] ? Number(process.argv[2]) : Infinity;
  let done = 0;
  let failed = 0;
  for (let i = 0; i < all.length && done + failed < limit; i++) {
    const card = all[i];
    const path = `cards/${card.id}.png`;
    if (existsSync(path)) {
      console.log(`✓ ${path} уже есть — пропускаю`);
      continue;
    }
    console.log(`🎨 ${card.id}: ${card.name}…`);
    const png = await generate(ai, card, i);
    if (png) {
      writeFileSync(path, png);
      done++;
      console.log(`  сохранено: ${path}`);
    } else {
      failed++;
      console.error(`  ✗ не получилось (бот будет слать эту карточку эмодзи-текстом)`);
    }
    await new Promise((r) => setTimeout(r, 3000)); // пауза, чтобы не упереться в rate limit
  }
  console.log(`\nГотово: ${done} новых, ${failed} неудачных. Теперь: git add cards && git commit && git push`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
