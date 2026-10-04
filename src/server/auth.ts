import { createHash, timingSafeEqual } from 'node:crypto';
import { FIXTURE_STAFF } from '@shared/fixtures';
import type { StaffRef } from '@shared/types';

export interface Principal extends StaffRef {
  token: string;
}

/** DEMO credentials only. Real identity / role management is an open deployment decision. */
const PRINCIPALS: Principal[] = Object.values(FIXTURE_STAFF).map((s) => ({ ...s }));

export function principalFromBearer(header: string | undefined): Principal | null {
  if (!header?.startsWith('Bearer ')) return null;
  const tok = header.slice(7).trim();
  return PRINCIPALS.find((p) => safeEq(p.token, tok)) ?? null;
}

export function staffRef(p: Principal): StaffRef {
  return { staffId: p.staffId, name: p.name, role: p.role, clinic: p.clinic };
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(`rhr-demo:${secret}`).digest('hex');
}

export function secretMatches(secret: string | undefined, hash: string): boolean {
  if (!secret) return false;
  return safeEq(hashSecret(secret), hash);
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const DEMO_TOKENS = PRINCIPALS.map((p) => ({ role: p.role, name: p.name, token: p.token }));
