import 'server-only';
import { hashPin, verifyPin } from '@/lib/auth/password';
import type { Role } from '@/lib/auth/roles';
import { prisma } from './client';

/** Shop-floor accounts. Sign-in is name + PIN; see lib/auth. */

export interface UserSummary {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: Date;
}

const SUMMARY = { id: true, name: true, role: true, active: true, createdAt: true } as const;

export async function listUsers(): Promise<UserSummary[]> {
  return prisma.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], select: SUMMARY });
}

/** Includes the hash, so it is only ever called from the Credentials provider. */
export async function findByNameForAuth(name: string) {
  return prisma.user.findUnique({ where: { name }, select: { ...SUMMARY, pinHash: true } });
}

export async function createUser(name: string, pin: string, role: Role = 'packer'): Promise<UserSummary> {
  return prisma.user.create({
    data: { name, pinHash: await hashPin(pin), role },
    select: SUMMARY,
  });
}

export async function setPin(id: string, pin: string): Promise<void> {
  await prisma.user.update({ where: { id }, data: { pinHash: await hashPin(pin) } });
}

export async function setRole(id: string, role: Role): Promise<void> {
  await prisma.user.update({ where: { id }, data: { role } });
}

export async function setActive(id: string, active: boolean): Promise<void> {
  await prisma.user.update({ where: { id }, data: { active } });
}

/** Used by the "change my PIN" form, which must prove the old one first. */
export async function changePin(id: string, currentPin: string, nextPin: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id }, select: { pinHash: true } });
  if (!user || !(await verifyPin(currentPin, user.pinHash))) return false;
  await setPin(id, nextPin);
  return true;
}
