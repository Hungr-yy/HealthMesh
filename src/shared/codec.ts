import type { LangCode, ReplyMethod, RequestInput, RequestType } from './types';
import { LANGS, REQUEST_TYPES } from './types';

/**
 * Prototype compact binary codec for a request ("node queue item"). It is NOT a real radio
 * protocol and has no RF framing, FEC or encryption: it exists so that request size on a
 * constrained link can be measured honestly and round-trip tested.
 *
 * Layout: [ver:1][flags:1][type|lang:1][msgId:16 bytes uuid][fields as tag,varint len,utf8]
 */
const VERSION = 1;

function uuidToBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('messageId must be a UUID');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToUuid(b: Uint8Array): string {
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

const TAGS = {
  name: 1,
  village: 2,
  details: 3,
  contact: 4,
  assistedBy: 5,
  supersedes: 6,
  related: 7,
};

export function encodeRequest(input: RequestInput, messageId: string): Uint8Array {
  const enc = new TextEncoder();
  const flags =
    (input.consent.recipientAcknowledged ? 1 : 0) |
    (input.consent.readersAcknowledged ? 2 : 0) |
    (input.consent.replyMethod === 'health_worker_reads' ? 4 : 0) |
    (input.entryMode === 'assisted' ? 8 : 0) |
    (input.enteredByVoice ? 16 : 0);
  const typeLang = (REQUEST_TYPES.indexOf(input.requestType) << 4) | LANGS.indexOf(input.language);
  const parts: number[] = [VERSION, flags, typeLang, ...uuidToBytes(messageId)];
  const field = (tag: number, value: string | undefined) => {
    if (!value) return;
    const b = enc.encode(value);
    parts.push(tag, ...varint(b.length), ...b);
  };
  field(TAGS.name, input.patientName);
  field(TAGS.village, input.village);
  field(TAGS.details, input.details);
  field(TAGS.contact, input.contact);
  field(TAGS.assistedBy, input.assistedBy);
  field(TAGS.supersedes, input.supersedesMessageId);
  field(TAGS.related, input.relatedCaseId);
  return Uint8Array.from(parts);
}

export function decodeRequest(bytes: Uint8Array): { messageId: string; input: RequestInput } {
  const dec = new TextDecoder();
  if (bytes[0] !== VERSION) throw new Error('unsupported codec version');
  const flags = bytes[1] ?? 0;
  const typeLang = bytes[2] ?? 0;
  const messageId = bytesToUuid(bytes.slice(3, 19));
  const requestType = REQUEST_TYPES[typeLang >> 4] as RequestType;
  const language = LANGS[typeLang & 0x0f] as LangCode;
  const vals: Record<number, string> = {};
  let i = 19;
  while (i < bytes.length) {
    const tag = bytes[i++] as number;
    let len = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[i++] as number;
      len |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    vals[tag] = dec.decode(bytes.slice(i, i + len));
    i += len;
  }
  const replyMethod: ReplyMethod = flags & 4 ? 'health_worker_reads' : 'village_device';
  const input: RequestInput = {
    requestType,
    patientName: vals[TAGS.name] ?? '',
    village: vals[TAGS.village] ?? '',
    details: vals[TAGS.details] ?? '',
    contact: vals[TAGS.contact] ?? '',
    language,
    entryMode: flags & 8 ? 'assisted' : 'typed',
    consent: {
      recipientAcknowledged: !!(flags & 1),
      readersAcknowledged: !!(flags & 2),
      replyMethod,
    },
  };
  if (flags & 16) input.enteredByVoice = true;
  if (vals[TAGS.assistedBy]) input.assistedBy = vals[TAGS.assistedBy] as string;
  if (vals[TAGS.supersedes]) input.supersedesMessageId = vals[TAGS.supersedes] as string;
  if (vals[TAGS.related]) input.relatedCaseId = vals[TAGS.related] as string;
  return { messageId, input };
}

export function encodedSize(input: RequestInput, messageId: string): number {
  return encodeRequest(input, messageId).length;
}
