'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { can, ROLES } from '@/lib/auth/roles';
import {
  changePin,
  createUser,
  saveSettings,
  setActive,
  setPin,
  setRole,
} from '@/lib/db';
import { SHEET_SIZES, type PackingSettings, type SheetSize, type SizeWeights } from '@/lib/domain';
import { slackNotify } from '@/lib/notify/slack';

/**
 * Settings mutations.
 *
 * Every one of these re-checks the role on the server. The tab is hidden from
 * non-admins and the proxy redirects them away from the route, but neither of
 * those is a security boundary — a server action is reachable by anyone who can
 * form the request.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return can.editSettings(session?.user.role);
}

// --- packing settings -----------------------------------------------------

/** Positive, finite, and small enough that a typo cannot plan a 1,000 lb box. */
const positive = (max: number) => z.coerce.number().positive().max(max);

const weightsSchema = z.object({
  sheet: positive(64),
  mailer: positive(64),
  base_in: positive(12),
  per_sheet_in: positive(1),
  columns: z.coerce.number().int().min(1).max(6),
});

const settingsSchema = z.object({
  boxCapOz: positive(2000),
  boxStackIn: positive(60),
  weights: z.object({
    '11x17': weightsSchema,
    '8.5x11': weightsSchema,
  }),
});

/**
 * Changing a cap changes what every open order would plan to, which is why this
 * is admin-only. Existing boxes are left alone; they are re-planned only when
 * someone presses Re-plan on the Box Planner.
 */
export async function savePackingSettings(input: unknown): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: 'Only an admin can change packing settings.' };

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Those values are not usable.' };
  }

  const weights = {} as Record<SheetSize, SizeWeights>;
  for (const size of SHEET_SIZES) weights[size] = parsed.data.weights[size];

  const next: PackingSettings = {
    boxCapOz: parsed.data.boxCapOz,
    boxStackIn: parsed.data.boxStackIn,
    weights,
  };

  await saveSettings(next);
  // Everything that plans or weighs reads these.
  for (const path of ['/settings', '/boxes', '/packer', '/intake', '/catalog']) revalidatePath(path);
  return { ok: true };
}

// --- users ----------------------------------------------------------------

const pinSchema = z
  .string()
  .regex(/^\d{4,8}$/, 'A PIN is 4 to 8 digits.');

const newUserSchema = z.object({
  name: z.string().trim().min(2, 'Give them a name.').max(60),
  pin: pinSchema,
  role: z.enum(ROLES),
});

export async function addUser(input: unknown): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: 'Only an admin can add users.' };

  const parsed = newUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };

  try {
    await createUser(parsed.data.name, parsed.data.pin, parsed.data.role);
  } catch {
    // The only constraint on the table is the unique name.
    return { ok: false, error: `Someone is already signing in as “${parsed.data.name}”.` };
  }

  revalidatePath('/settings');
  return { ok: true };
}

const userSchema = z.object({ userId: z.string().min(1) });

export async function changeUserRole(input: unknown): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: 'Only an admin can change roles.' };

  const parsed = userSchema.extend({ role: z.enum(ROLES) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a valid role.' };

  const session = await auth();
  if (session?.user.id === parsed.data.userId && parsed.data.role !== 'admin') {
    return { ok: false, error: 'Demoting yourself would lock you out of this screen.' };
  }

  await setRole(parsed.data.userId, parsed.data.role);
  revalidatePath('/settings');
  return { ok: true };
}

export async function setUserActive(input: unknown): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: 'Only an admin can deactivate users.' };

  const parsed = userSchema.extend({ active: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'No such user.' };

  const session = await auth();
  if (session?.user.id === parsed.data.userId && !parsed.data.active) {
    return { ok: false, error: 'You cannot deactivate yourself.' };
  }

  await setActive(parsed.data.userId, parsed.data.active);
  revalidatePath('/settings');
  return { ok: true };
}

/** An admin resetting someone else's forgotten PIN. No old PIN required. */
export async function resetUserPin(input: unknown): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: 'Only an admin can reset a PIN.' };

  const parsed = userSchema.extend({ pin: pinSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'A PIN is 4 to 8 digits.' };

  await setPin(parsed.data.userId, parsed.data.pin);
  revalidatePath('/settings');
  return { ok: true };
}

/** Anyone changing their own PIN, which requires proving the current one. */
export async function changeMyPin(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user.id) return { ok: false, error: 'Sign in again.' };

  const parsed = z
    .object({ currentPin: z.string().min(1, 'Enter your current PIN.'), nextPin: pinSchema })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };

  const changed = await changePin(session.user.id, parsed.data.currentPin, parsed.data.nextPin);
  if (!changed) return { ok: false, error: 'That is not your current PIN.' };
  return { ok: true };
}

// --- notifications --------------------------------------------------------

export async function sendSlackTest(): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: 'Only an admin can send a test.' };

  const result = await slackNotify('✅ JBG test — Slack pick notifications are working.');
  if (result.ok) return { ok: true };
  return {
    ok: false,
    error:
      result.reason === 'unconfigured'
        ? 'No webhook is set. Add SLACK_WEBHOOK_URL to the server environment.'
        : `Slack rejected it: ${result.detail ?? 'no detail'}`,
  };
}
