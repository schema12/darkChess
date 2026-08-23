/**
 * 随机源抽象。开局打乱 32 棋子的随机源可注入 seed，
 * 保证测试/回放可复现，同时满足“随机打乱”需求。
 */
export interface Rng {
  /** 返回 [0, maxExclusive) 区间内的整数。 */
  nextInt(maxExclusive: number): number;
}

/** 默认随机源（基于 Math.random）。 */
export function mathRandomRng(): Rng {
  return {
    nextInt(maxExclusive) {
      return Math.floor(Math.random() * maxExclusive);
    },
  };
}

/** 可复现的 mulberry32 伪随机源（用于测试/回放）。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    nextInt(maxExclusive) {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const r = ((t ^ (t >>> 14)) >>> 0);
      return r % maxExclusive;
    },
  };
}

/** Fisher–Yates 洗牌，返回新数组。 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}
