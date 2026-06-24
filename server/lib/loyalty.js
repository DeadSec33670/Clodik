'use strict';
/**
 * Программа лояльности ArhoShop.
 * Бизнес-правила ТЗ (повторены точно):
 *  - 1 бонус = 1 ₽;
 *  - уровень определяется по сумме всех покупок (spent);
 *  - кэшбэк начисляется по уровню, действующему НА МОМЕНТ покупки
 *    (т.е. от spent ДО прибавления текущего заказа);
 *  - начисленные бонусы = floor(total * rate текущего уровня).
 */

// Уровни строго по ТЗ. Пороги — нижняя граница суммы покупок.
const TIERS = [
  { key: 'none',   name: 'Без уровня', icon: '⚪', min: 0,      rate: 0 },
  { key: 'bronze', name: 'Бронза',     icon: '🥉', min: 50000,  rate: 0.01 },
  { key: 'silver', name: 'Серебро',    icon: '🥈', min: 100000, rate: 0.02 },
  { key: 'gold',   name: 'Золото',     icon: '🥇', min: 250000, rate: 0.035 },
  { key: 'plat',   name: 'Платина',    icon: '💎', min: 500000, rate: 0.05 },
];

/** Текущий уровень по сумме покупок + ссылка на следующий уровень. */
function tierFor(spent) {
  spent = Math.max(0, Number(spent) || 0);
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (spent >= TIERS[i].min) idx = i;
  }
  return Object.assign({}, TIERS[idx], {
    idx,
    next: TIERS[idx + 1] || null,
  });
}

/** Бонусы за покупку на сумму total при текущем накопленном spent. */
function earnedFor(spent, total) {
  const rate = tierFor(spent).rate;
  return Math.max(0, Math.floor((Number(total) || 0) * rate));
}

/** Прогресс до следующего уровня в процентах (для прогресс-бара). */
function progress(spent) {
  const t = tierFor(spent);
  if (!t.next) return 100;
  const span = t.next.min - t.min;
  if (span <= 0) return 100;
  return Math.min(100, Math.max(4, Math.round(((spent - t.min) / span) * 100)));
}

module.exports = { TIERS, tierFor, earnedFor, progress };
