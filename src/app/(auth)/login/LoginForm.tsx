'use client';

import Image from 'next/image';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { login, type LoginState } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-5">
      <div className="flex flex-col items-center gap-3">
        <Image
          src="/logo.png"
          alt="Jelly Bean Genius"
          width={128}
          height={128}
          priority
          className="h-32 w-32 object-contain drop-shadow-[0_0_18px_rgba(78,207,154,0.25)]"
        />
        <h1 className="text-xl font-extrabold text-ink-bright">JBG Fulfillment</h1>
      </div>

      {next ? <input type="hidden" name="next" value={next} /> : null}

      <Field label="Name">
        {(id) => (
          <TextInput
            id={id}
            name="name"
            autoComplete="username"
            autoCapitalize="words"
            required
            autoFocus
          />
        )}
      </Field>

      <Field label="PIN" hint="Four digits or more.">
        {(id) => (
          <TextInput
            id={id}
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            required
          />
        )}
      </Field>

      {state.error ? (
        <p role="alert" className="rounded-sm bg-danger-bg px-3 py-2 text-sm font-semibold text-danger-fg">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" tone="primary" size="lg" block pending={pending}>
      Sign in
    </Button>
  );
}
