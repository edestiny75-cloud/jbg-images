/**
 * Roles, and what each may do.
 *
 * The legacy tool had no concept of a user at all, which is how
 * `retryAllErrors()` (index.html:975) came to issue an unscoped
 * `UPDATE print_jobs SET status='queued' WHERE status='error'` across the whole
 * table — one person's retry requeued everybody's failures.
 */

export const ROLES = ['packer', 'manager', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

/** Roles are ordered: each one can do everything the one below it can. */
const RANK: Record<Role, number> = { packer: 0, manager: 1, admin: 2 };

export function atLeast(role: Role | undefined, minimum: Role): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[minimum];
}

export const can = {
  /** Pick and pack boxes, record actual quantities, print labels. */
  pack: (role?: Role) => atLeast(role, 'packer'),
  /** Upload lists, plan boxes, queue print jobs, edit prices. */
  plan: (role?: Role) => atLeast(role, 'manager'),
  /** Retry another user's failed print jobs, in bulk. */
  retryOthersJobs: (role?: Role) => atLeast(role, 'manager'),
  /** Change carton caps and sheet weights, which re-plans every open order. */
  editSettings: (role?: Role) => atLeast(role, 'admin'),
  /** Create and deactivate users. */
  manageUsers: (role?: Role) => atLeast(role, 'admin'),
  /** Delete a shipment and everything under it. */
  deleteOrders: (role?: Role) => atLeast(role, 'admin'),
} as const;
