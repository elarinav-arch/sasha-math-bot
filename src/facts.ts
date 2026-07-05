export interface Fact {
  key: string; // "7x8" или "56/8"
  question: string; // "7 × 8 = ?"
  answer: number;
  hint: string;
}

export function allFacts(): Fact[] {
  const facts: Fact[] = [];
  for (let a = 2; a <= 9; a++) {
    for (let b = 2; b <= 9; b++) {
      facts.push({
        key: `${a}x${b}`,
        question: `${a} × ${b} = ?`,
        answer: a * b,
        hint: mulHint(a, b),
      });
      facts.push({
        key: `${a * b}/${b}`,
        question: `${a * b} ÷ ${b} = ?`,
        answer: a,
        hint: `Деление — это умножение наоборот: ${b} × ? = ${a * b}. Вспомни таблицу на ${b}!`,
      });
    }
  }
  return facts;
}

function mulHint(a: number, b: number): string {
  const [x, y] = a <= b ? [a, b] : [b, a];
  if (x === 7 && y === 8) return "Запоминалка: 5, 6, 7, 8 → 56 = 7 × 8!";
  if (x === 6 && y === 8) return "6 × 8: сначала 6 × 4 = 24, потом удвой → 48.";
  if (x === 6 && y === 7) return "Рифма: шестью семь — сорок два, помни это ты всегда!";
  if (y === 9) return `Приём для ×9: ${x} × 10 = ${x * 10}, теперь отними ${x}.`;
  if (y === 5 || x === 5) return "Приём для ×5: умножь на 10 и раздели пополам.";
  if (x === 4 || y === 4) return "Приём для ×4: удвой число, а потом удвой ещё раз.";
  if (x === 2) return `×2 — это просто удвоить: ${y} + ${y}.`;
  if (x === y) return `${x} × ${x} — квадрат! Вспомни соседа: ${x} × ${x - 1} = ${x * (x - 1)}, и прибавь ещё ${x}.`;
  return `Шаг назад: ${a} × ${b - 1} = ${a * (b - 1)}, теперь прибавь ещё ${a}.`;
}
