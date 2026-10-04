import type { Engine } from './engine';
import { Router, type Req } from './http';
import { ApiError, type RequestInput } from '@shared/types';

/** Credential for village-device endpoints: `Authorization: Case <secret>`. */
export function caseSecret(req: Req): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Case ') ? h.slice(5).trim() : undefined;
}

export function buildRouter(engine: Engine): Router {
  const r = new Router();

  r.add('GET', '/api/health', () => ({ ok: true, simulated: true }));
  r.add('GET', '/api/node/status', () => engine.nodeStatus());

  // ------------------------------------------------------------- village device (patient / CHW)
  r.add('POST', '/api/node/requests', (req) => {
    const b = req.body as { messageId?: string; input?: RequestInput } | undefined;
    if (!b?.messageId || !b.input)
      throw new ApiError('bad_request', 'messageId and input required', 400);
    return engine.submit(b.input, b.messageId, caseSecret(req));
  });
  r.add('GET', '/api/node/cases/by-message/:messageId', (req) =>
    engine.getCaseByMessageId(req.params.messageId ?? '', caseSecret(req)),
  );
  r.add('GET', '/api/node/cases/lookup', (req) =>
    engine.lookupByReference(req.query.get('ref') ?? '', caseSecret(req)),
  );
  r.add('GET', '/api/node/cases/:caseId', (req) =>
    engine.getCase(req.params.caseId ?? '', caseSecret(req)),
  );
  r.add('GET', '/api/node/cases/:caseId/events', (req) =>
    engine.getEvents(
      req.params.caseId ?? '',
      req.query.get('cursor') ?? undefined,
      caseSecret(req),
    ),
  );

  // ------------------------------------------------------------- simulator controls (demo only)
  r.add('POST', '/api/sim/restart', () => {
    engine.replay();
    return engine.nodeStatus();
  });

  return r;
}
