export type Rarity = "common" | "rare" | "legendary";

export interface Card {
  id: string;
  name: string;
  rarity: Rarity;
  emoji: string;
}

export const CARDS: Card[] = [
  { id: "c01", name: "Кибер-котёнок Байт", rarity: "common", emoji: "🐱⚡" },
  { id: "c02", name: "Дрон-щенок Пиксель", rarity: "common", emoji: "🐶🔧" },
  { id: "c03", name: "Робо-хомяк Болтик", rarity: "common", emoji: "🐹🔩" },
  { id: "c04", name: "Лазер-зайка Клик", rarity: "common", emoji: "🐰✨" },
  { id: "c05", name: "Турбо-ёжик Искра", rarity: "common", emoji: "🦔⚡" },
  { id: "c06", name: "Стальная мышка Чип", rarity: "common", emoji: "🐭💾" },
  { id: "c07", name: "Робо-утёнок Квак-3000", rarity: "common", emoji: "🦆🤖" },
  { id: "c08", name: "Кибер-черепашка Танк", rarity: "common", emoji: "🐢🛡️" },
  { id: "c09", name: "Дрон-попугай Эхо", rarity: "common", emoji: "🦜📡" },
  { id: "c10", name: "Робо-пингвин Айс", rarity: "common", emoji: "🐧❄️" },
  { id: "c11", name: "Механо-белка Гайка", rarity: "common", emoji: "🐿️🔧" },
  { id: "c12", name: "Кибер-жабка Прыг", rarity: "common", emoji: "🐸💚" },
  { id: "c13", name: "Робо-крабик Клешня", rarity: "common", emoji: "🦀⚙️" },
  { id: "c14", name: "Дрон-пчёлка Жужа", rarity: "common", emoji: "🐝🚁" },
  { id: "c15", name: "Стальной котик Винтик", rarity: "common", emoji: "🐈🔩" },
  { id: "c16", name: "Робо-мишка Терми", rarity: "common", emoji: "🐻🤖" },
  { id: "c17", name: "Кибер-щенок Вольт", rarity: "common", emoji: "🐕⚡" },
  { id: "c18", name: "Механическая сова Софа", rarity: "common", emoji: "🦉💡" },
  { id: "c19", name: "Робо-лиса Вспышка", rarity: "rare", emoji: "🦊⚡" },
  { id: "c20", name: "Мега-панда Сервер", rarity: "rare", emoji: "🐼💻" },
  { id: "c21", name: "Дрон-дельфин Сонар", rarity: "rare", emoji: "🐬📡" },
  { id: "c22", name: "Кибер-волк Рекс", rarity: "rare", emoji: "🐺🌙" },
  { id: "c23", name: "Робо-тигрёнок Байтс", rarity: "rare", emoji: "🐯⚙️" },
  { id: "c24", name: "Плазма-кошка Нова", rarity: "rare", emoji: "🐱🌟" },
  { id: "c25", name: "Дрон-орёл Радар", rarity: "rare", emoji: "🦅🛰️" },
  { id: "c26", name: "Робо-акула Мегабайт", rarity: "rare", emoji: "🦈💙" },
  { id: "c27", name: "Кибер-олень Рог-2000", rarity: "rare", emoji: "🦌✨" },
  { id: "c28", name: "Кибер-единорог Глюк", rarity: "legendary", emoji: "🦄💜" },
  { id: "c29", name: "Робо-дракон Терабайт", rarity: "legendary", emoji: "🐉🔥" },
  { id: "c30", name: "Призрачный дрон Юзи", rarity: "legendary", emoji: "👾💜" },
];

export const STREAK_CARDS: Record<number, Card> = {
  3: { id: "s03", name: "Бронзовый пропеллер — 3 дня подряд!", rarity: "rare", emoji: "🥉🚁" },
  7: { id: "s07", name: "Серебряное крыло — неделя подряд!", rarity: "rare", emoji: "🥈🕊️" },
  14: { id: "s14", name: "Золотой реактор — 2 недели подряд!", rarity: "legendary", emoji: "🥇⚡" },
  30: { id: "s30", name: "Алмазное ядро — месяц подряд!!!", rarity: "legendary", emoji: "💎🤖" },
};

const ALL: Card[] = [...CARDS, ...Object.values(STREAK_CARDS)];

export function cardById(id: string): Card | undefined {
  return ALL.find((c) => c.id === id);
}

export function rarityLabel(r: Rarity): string {
  return r === "legendary" ? "⭐ ЛЕГЕНДАРНАЯ ⭐" : r === "rare" ? "💠 редкая" : "🔹 обычная";
}
