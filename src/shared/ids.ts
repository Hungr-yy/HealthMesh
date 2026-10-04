/** Short human-readable reference. Crockford-like alphabet without 0/O/1/I/L/U. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function refFromSeed(seed: number, attempt = 0): string {
  let n = (seed + attempt * 7919) >>> 0;
  let s = '';
  for (let i = 0; i < 4; i++) {
    n = Math.imul(n ^ (n >>> 15), 2246822519) >>> 0;
    s += ALPHABET[n % ALPHABET.length];
  }
  return `NR-${s}`;
}

export function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

export function newSecret(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
