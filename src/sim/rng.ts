export interface Rng {
  (): number;
  state(): number;
  setState(n: number): void;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const rng = (() => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  rng.state = () => a >>> 0;
  rng.setState = (n: number) => {
    a = n >>> 0;
  };
  return rng;
}

export function randInt(rng: Rng, min: number, max: number) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, arr: T[]): T {
  return arr[Math.floor(rng() * Math.max(1, arr.length))]!;
}

export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

export function chance(rng: Rng, p: number) {
  return rng() < p;
}

export function hash32(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
