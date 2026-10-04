import type { StaffRole } from '@shared/types';

/**
 * Role-based permissions, enforced in the service (never by hidden buttons or unguessable
 * references). Patients and village devices are not staff: they prove access to ONE case with its
 * case secret, which is checked separately in the engine.
 *
 * 'clinician' is the clinic reviewer. The network operator never receives clinical content.
 */
export const PERMISSIONS = [
  'inbox.read', // list cases with clinical fields
  'case.read_content', // original text, translation, draft summary, consent records
  'case.claim',
  'case.start_review',
  'case.set_priority',
  'case.draft_reply',
  'case.approve_reply', // approve a reply OR a clarification question
  'case.close',
  'case.handover',
  'coverage.read', // aggregate only; case rows only with inbox.read
  'coverage.set',
  'gateway.read',
  'node.health.read',
  'operator.overview',
  'operator.requeue',
  'audit.read', // identifiers only, no content
  'admin.config.read',
  'admin.config.write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  clinician: [
    'inbox.read',
    'case.read_content',
    'case.claim',
    'case.start_review',
    'case.set_priority',
    'case.draft_reply',
    'case.approve_reply',
    'case.close',
    'coverage.read',
  ],
  coordinator: [
    'inbox.read',
    'case.read_content',
    'case.claim',
    'case.set_priority',
    'case.close',
    'case.handover',
    'coverage.read',
    'coverage.set',
    'audit.read',
  ],
  // A community health worker works on the village device (case secret); no clinic-side access.
  chw: [],
  operator: [
    'coverage.read',
    'gateway.read',
    'node.health.read',
    'operator.overview',
    'operator.requeue',
    'audit.read',
  ],
  admin: [
    'coverage.read',
    'gateway.read',
    'node.health.read',
    'operator.overview',
    'audit.read',
    'admin.config.read',
    'admin.config.write',
  ],
};

export function can(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Permissions that expose clinical content; no operator/admin role may hold one. */
export const CLINICAL_CONTENT_PERMISSIONS: readonly Permission[] = [
  'case.read_content',
  'inbox.read',
];
