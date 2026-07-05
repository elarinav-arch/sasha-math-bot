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

function prompt(card: Card): string {
  const rarityStyle =
    card.rarity === "legendary"
      ? "epic golden ornate card frame, radiant glow, sparkles"
      : card.rarity === "rare"
        ? "silver-blue card frame with soft shine"
        : "simple purple card frame";
  return (
    `Collectible trading card illustration for a kids' math game: cute chibi robot animal ` +
    `"${card.name}" (robotic pet). Style inspired by the Murder Drones cartoon aesthetic: ` +
    `glossy dark metal body, glowing purple neon accents, big expressive friendly eyes. ` +
    `Kid-appropriate, cheerful, absolutely not scary. Centered character, square format, ` +
    `dark background with soft neon glow, ${rarityStyle}. No text, no letters on the image.`
  );
}

async function generate(ai: GoogleGenAI, card: Card): Promise<Buffer | null> {
  for (const model of IMAGE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt(card),
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
  let done = 0;
  let failed = 0;
  for (const card of all) {
    const path = `cards/${card.id}.png`;
    if (existsSync(path)) {
      console.log(`✓ ${path} уже есть — пропускаю`);
      continue;
    }
    console.log(`🎨 ${card.id}: ${card.name}…`);
    const png = await generate(ai, card);
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
