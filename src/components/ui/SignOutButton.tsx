import { signOut } from '@/lib/auth';
import { Button } from './Button';

export function SignOutButton() {
  return (
    <form
      action={async () => {
        'use server';
        await signOut({ redirectTo: '/login' });
      }}
    >
      <Button type="submit" tone="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
