import { HOSTED_BANNER, isHosted, sharedDatabaseUrl } from './hosted';
import { principalFromBearer, staffRef, DEMO_TOKENS } from './auth';
import type { Engine } from './engine';
import { Router, type Req } from './http';
import {
  ApiError,
  type AdminConfig,
  type CloseOutcome,
  type ReplyKind,
  type RequestInput,
} from '@shared/types';
import { PERMISSIONS, ROLE_PERMISSIONS } from './permissions';

/** Credential for village-device endpoints: `Authorization: Case <secret>`. */
export function caseSecret(req: Req): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Case ') ? h.slice(5).trim() : undefined;
}

export function buildRouter(engine: Engine): Router {
  const r = new Router();

  r.add('GET', '/api/health', () => ({ ok: true, simulated: true }));
  // Deployment mode, so the UI can show the hosted-demo banner. No secrets, no state.
  r.add('GET', '/api/mode', () => ({
    hosted: isHosted(),
    banner: isHosted() ? HOSTED_BANNER : null,
    // how state is held: shared database log, a local journal file, or per-instance only
    state: sharedDatabaseUrl() ? 'shared-database' : 'local-journal',
  }));
  r.add('GET', '/api/node/status', () => engine.nodeStatus());
  r.add('GET', '/api/node/health', () => engine.nodeHealth());
  r.add('GET', '/api/permissions', () => ({ permissions: PERMISSIONS, roles: ROLE_PERMISSIONS }));

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

  r.add('POST', '/api/node/cases/:caseId/reply/open', (req) => {
    const b = (req.body ?? {}) as { assistedReadingBy?: string | null };
    engine.markReplyOpened(req.params.caseId ?? '', caseSecret(req), b.assistedReadingBy ?? null);
  });
  r.add('POST', '/api/node/cases/:caseId/withdraw', (req) =>
    engine.withdraw(req.params.caseId ?? '', caseSecret(req)),
  );

  // ------------------------------------------------------------- clinic staff
  const staff = (req: Req) => {
    const p = principalFromBearer(req.headers.authorization);
    return p ? staffRef(p) : null;
  };
  const cid = (req: Req) => req.params.caseId ?? '';
  r.add('GET', '/api/clinic/inbox', (req) =>
    engine.clinicInbox(staff(req), req.query.get('sort') === 'priority' ? 'priority' : 'oldest'),
  );
  r.add('GET', '/api/clinic/templates', () => engine.templates());
  r.add('GET', '/api/clinic/cases/:caseId', (req) => engine.clinicCaseView(staff(req), cid(req)));
  r.add('POST', '/api/clinic/cases/:caseId/read', (req) => engine.markRead(staff(req), cid(req)));
  r.add('POST', '/api/clinic/cases/:caseId/claim', (req) => engine.claim(staff(req), cid(req)));
  r.add('POST', '/api/clinic/cases/:caseId/start-review', (req) =>
    engine.startReview(staff(req), cid(req)),
  );
  r.add('POST', '/api/clinic/cases/:caseId/priority', (req) => {
    const b = req.body as { level?: 'routine' | 'soon' | 'urgent'; reason?: string } | undefined;
    engine.setPriority(staff(req), cid(req), b?.level ?? 'routine', b?.reason ?? '');
  });
  r.add('POST', '/api/clinic/cases/:caseId/reply-draft', (req) => {
    const b = req.body as { text?: string; templateId?: string | null } | undefined;
    engine.saveReplyDraft(staff(req), cid(req), b?.text ?? '', b?.templateId ?? null);
  });
  r.add('POST', '/api/clinic/cases/:caseId/reply/approve', (req) => {
    const b = req.body as
      | {
          text?: string;
          templateId?: string | null;
          inReplyToMessageId?: string;
          kind?: ReplyKind;
        }
      | undefined;
    return engine.approveReply(staff(req), cid(req), {
      text: b?.text ?? '',
      templateId: b?.templateId ?? null,
      inReplyToMessageId: b?.inReplyToMessageId ?? '',
      kind: b?.kind === 'clarification' ? 'clarification' : 'reply',
    });
  });
  r.add('POST', '/api/clinic/cases/:caseId/close', (req) => {
    const b = req.body as { outcome?: CloseOutcome; note?: string } | undefined;
    engine.closeCase(staff(req), cid(req), b?.outcome as CloseOutcome, b?.note ?? '');
  });
  r.add('POST', '/api/clinic/cases/:caseId/handover', (req) => {
    const b = req.body as { toStaffId?: string; note?: string } | undefined;
    engine.handover(staff(req), cid(req), b?.toStaffId ?? '', b?.note ?? '');
  });
  r.add('GET', '/api/clinic/coverage', (req) => engine.coverage(staff(req)));
  r.add('POST', '/api/clinic/coverage', (req) => {
    const b = req.body as { staffed?: boolean; note?: string } | undefined;
    engine.setCoverage(staff(req), b?.staffed === true, b?.note ?? '');
    return engine.coverage(staff(req));
  });

  // ------------------------------------------------------------- gateway, audit, administration
  r.add('GET', '/api/gateway/status', (req) => engine.gateway(staff(req)));
  r.add('GET', '/api/audit', (req) => engine.auditTrail(staff(req)));
  r.add('GET', '/api/admin/config', (req) => engine.adminConfig(staff(req)));
  r.add('POST', '/api/admin/config', (req) =>
    engine.updateAdminConfig(staff(req), (req.body ?? {}) as Partial<AdminConfig>),
  );

  // ------------------------------------------------------------- operator (no patient content)
  r.add('GET', '/api/operator/overview', (req) => engine.operatorOverview(staff(req)));
  r.add('POST', '/api/operator/requeue', (req) => {
    engine.operatorRequeue(staff(req), (req.body as { flowId?: string } | undefined)?.flowId ?? '');
  });

  // ------------------------------------------------------------- simulator controls (demo only)
  // These are the simulation harness (weather, power, time), NOT product endpoints, and are
  // unauthenticated by design. Set RHR_SIM_CONTROLS=off to remove them entirely.
  if (process.env.RHR_SIM_CONTROLS !== 'off') {
    r.add('GET', '/api/sim/state', () => engine.simState());
    r.add('GET', '/api/sim/demo-tokens', () => DEMO_TOKENS);
    r.add('POST', '/api/sim/advance', (req) => {
      engine.advance(Number((req.body as { ticks?: number } | undefined)?.ticks ?? 1));
      return engine.simState();
    });
    r.add('POST', '/api/sim/link', (req) => {
      const b = req.body as { index?: number; up?: boolean } | undefined;
      engine.setLink(Number(b?.index), b?.up === true);
      return engine.simState();
    });
    r.add('POST', '/api/sim/power-cut', (req) => {
      engine.powerCut(
        Number((req.body as { durationTicks?: number } | undefined)?.durationTicks ?? 10),
      );
      // Drop all in-memory state and rebuild it from the journal: this IS the recovery path.
      engine.restart();
      return engine.simState();
    });
    r.add('POST', '/api/sim/restart', () => {
      engine.restart();
      return engine.simState();
    });
    r.add('POST', '/api/sim/reset', () => {
      engine.reset();
      return engine.simState();
    });
    r.add('POST', '/api/sim/config', (req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const allowed = [
        'maxRetries',
        'ttlTicks',
        'translationAvailable',
        'storageLimitBytes',
        'faults',
        'lossPct',
        'seed',
        'hopLatency',
        'backoff',
      ];
      const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
      engine.configure(patch as Parameters<Engine['configure']>[0]);
      return engine.simState();
    });
    r.add('POST', '/api/sim/battery', (req) => {
      const b = req.body as
        { node?: Parameters<Engine['reportBattery']>[0]; percent?: number } | undefined;
      engine.reportBattery(b?.node ?? 'village', Number(b?.percent ?? 0));
      return engine.simState();
    });
  }

  return r;
}
