'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, TextInput } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { changeMyPin } from './actions';

/** Changing your own PIN, which requires proving you know the current one. */
export function ChangePinPanel() {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const mismatch = confirmPin.length > 0 && confirmPin !== nextPin;
  const ready = currentPin.length >= 4 && nextPin.length >= 4 && confirmPin === nextPin;

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);

  return (
    <Card className="p-5">
      <h2 className="text-lg font-extrabold">Your PIN</h2>
      <form
        className="mt-3 grid gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await changeMyPin({ currentPin, nextPin });
            toast(result.ok ? 'PIN changed.' : result.error, result.ok ? 'success' : 'danger');
            if (result.ok) {
              setCurrentPin('');
              setNextPin('');
              setConfirmPin('');
            }
          });
        }}
      >
        <Field label="Current PIN">
          {(id) => (
            <TextInput
              id={id}
              value={currentPin}
              inputMode="numeric"
              autoComplete="current-password"
              onChange={(e) => setCurrentPin(digits(e.target.value))}
            />
          )}
        </Field>
        <Field label="New PIN" hint="4 to 8 digits.">
          {(id) => (
            <TextInput
              id={id}
              value={nextPin}
              inputMode="numeric"
              autoComplete="new-password"
              onChange={(e) => setNextPin(digits(e.target.value))}
            />
          )}
        </Field>
        <Field label="Confirm new PIN" error={mismatch ? 'The two do not match.' : null}>
          {(id) => (
            <TextInput
              id={id}
              value={confirmPin}
              inputMode="numeric"
              autoComplete="new-password"
              onChange={(e) => setConfirmPin(digits(e.target.value))}
            />
          )}
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" pending={pending} disabled={!ready}>
            Change PIN
          </Button>
        </div>
      </form>
    </Card>
  );
}
