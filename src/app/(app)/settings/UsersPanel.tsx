'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ROLES, type Role } from '@/lib/auth/roles';
import { addUser, changeUserRole, resetUserPin, setUserActive } from './actions';

/**
 * Shop-floor accounts. Entirely new: the legacy tool had no users at all.
 *
 * PINs are only ever written, never read back — the table stores a scrypt hash
 * (lib/auth/password.ts), so "reset" is the only recovery there is.
 */

export interface UserRow {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

const ROLE_HINT: Record<Role, string> = {
  packer: 'Catalog, Print Jobs, Packer, Box Register.',
  manager: 'Everything a packer can do, plus intake, planning and printing.',
  admin: 'Everything, plus settings, users and deleting orders.',
};

export function UsersPanel({ users, currentUserId }: { users: readonly UserRow[]; currentUserId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);

  const run = (task: () => Promise<{ ok: boolean; error?: string }>, success: string, done?: () => void) =>
    startTransition(async () => {
      const result = await task();
      toast(result.ok ? success : (result.error ?? 'That did not work.'), result.ok ? 'success' : 'danger');
      if (result.ok) {
        done?.();
        router.refresh();
      }
    });

  const columns: ReadonlyArray<Column<UserRow>> = [
    {
      key: 'name',
      header: 'Name',
      cell: (user) => (
        <span className="flex flex-col">
          <b>{user.name}</b>
          {user.id === currentUserId && <span className="text-xs text-muted">that&rsquo;s you</span>}
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      width: 'w-44',
      cell: (user) => (
        <Select
          aria-label={`Role for ${user.name}`}
          value={user.role}
          disabled={pending}
          onChange={(e) =>
            run(
              () => changeUserRole({ userId: user.id, role: e.target.value as Role }),
              `${user.name} is now a ${e.target.value}.`,
            )
          }
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-28',
      cell: (user) =>
        user.active ? <Chip tone="success">active</Chip> : <Chip tone="neutral">disabled</Chip>,
    },
    {
      key: 'created',
      header: 'Added',
      secondary: true,
      cell: (user) => <span className="text-muted">{new Date(user.createdAt).toLocaleDateString()}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: 'w-56',
      cell: (user) => (
        <span className="flex justify-end gap-2">
          <Button size="sm" tone="ghost" disabled={pending} onClick={() => setResetting(user)}>
            Reset PIN
          </Button>
          <Button
            size="sm"
            tone={user.active ? 'danger' : 'default'}
            pending={pending}
            onClick={() =>
              run(
                () => setUserActive({ userId: user.id, active: !user.active }),
                user.active ? `${user.name} can no longer sign in.` : `${user.name} can sign in again.`,
              )
            }
          >
            {user.active ? 'Disable' : 'Enable'}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Users</h2>
          <p className="mt-1 text-sm text-muted">
            Sign-in is a name and a PIN, which is what works on a shop-floor iPad.
          </p>
        </div>
        <Button className="ml-auto" size="sm" onClick={() => setAdding(true)}>
          + Add user
        </Button>
      </div>

      <DataTable
        className="mt-4"
        columns={columns}
        rows={users}
        rowKey={(user) => user.id}
        rowTone={(user) => (user.active ? undefined : 'warn')}
        empty="No users yet."
      />

      <AddUserModal
        open={adding}
        pending={pending}
        onClose={() => setAdding(false)}
        onSubmit={(values) => run(() => addUser(values), `${values.name} can now sign in.`, () => setAdding(false))}
      />

      <ResetPinModal
        user={resetting}
        pending={pending}
        onClose={() => setResetting(null)}
        onSubmit={(pin) =>
          resetting &&
          run(
            () => resetUserPin({ userId: resetting.id, pin }),
            `${resetting.name}'s PIN is set.`,
            () => setResetting(null),
          )
        }
      />
    </Card>
  );
}

function AddUserModal({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: { name: string; pin: string; role: Role }) => void;
}) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<Role>('packer');

  const close = () => {
    setName('');
    setPin('');
    setRole('packer');
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Add a user">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ name: name.trim(), pin, role });
        }}
      >
        <Field label="Name" hint="What they type to sign in. It must be unique.">
          {(id) => (
            <TextInput id={id} value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label="PIN" hint="4 to 8 digits. Stored as a hash — nobody can read it back.">
          {(id) => (
            <TextInput
              id={id}
              value={pin}
              inputMode="numeric"
              autoComplete="off"
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          )}
        </Field>
        <Field label="Role" hint={ROLE_HINT[role]}>
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" tone="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" pending={pending} disabled={name.trim().length < 2 || pin.length < 4}>
            Add user
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPinModal({
  user,
  pending,
  onClose,
  onSubmit,
}: {
  user: UserRow | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (pin: string) => void;
}) {
  const [pin, setPin] = useState('');

  const close = () => {
    setPin('');
    onClose();
  };

  return (
    <Modal open={user !== null} onClose={close} title={user ? `Reset ${user.name}'s PIN` : 'Reset PIN'}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(pin);
        }}
      >
        <p className="text-sm text-muted">
          The old PIN cannot be recovered, only replaced. Tell them the new one in person.
        </p>
        <Field label="New PIN" hint="4 to 8 digits.">
          {(id) => (
            <TextInput
              id={id}
              value={pin}
              inputMode="numeric"
              autoComplete="off"
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" tone="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" pending={pending} disabled={pin.length < 4}>
            Set PIN
          </Button>
        </div>
      </form>
    </Modal>
  );
}
