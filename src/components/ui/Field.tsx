'use client';

import { cn } from '@/lib/ui/cn';
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/**
 * Form controls. Every input is 16px, which is the threshold below which iOS
 * zooms the viewport on focus — the shop's iPads made that non-negotiable.
 */

const controlBase =
  'w-full rounded-sm border border-line bg-panel-2 px-3 py-2.5 text-touch text-ink ' +
  'placeholder:text-muted-dim min-h-11 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={id} className="text-xs font-bold text-muted">
          {label}
        </label>
      ) : null}
      {children(id)}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-danger-fg">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-dim">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(controlBase, className)} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cn(controlBase, 'font-semibold', className)} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(controlBase, 'min-h-24 resize-y leading-relaxed', className)} />;
}

export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number | '';
  onValueChange: (value: number | '') => void;
}

/**
 * Integer quantity input. Replaces three verbatim copies (index.html:897, :1020,
 * :1449) plus seven near-copies, each of which stripped non-digits with its own
 * slightly different regex.
 */
export function QtyInput({ value, onValueChange, className, ...rest }: NumberInputProps) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={value === '' ? '' : String(value)}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^0-9]/g, '');
        onValueChange(digits === '' ? '' : Number.parseInt(digits, 10));
      }}
      className={cn(controlBase, 'text-right tabular-nums', className)}
    />
  );
}

export interface MoneyInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  /** The raw text, not a number: "12." is a legal intermediate state. */
  value: string;
  onValueChange: (text: string) => void;
}

/**
 * Currency input. Replaces seven copies (index.html:1311-1316, :1450), which
 * between them accepted, rejected and silently truncated decimals differently.
 *
 * The value is the text the user typed, deliberately. A `number` cannot hold
 * the half-typed "12.", so a numeric round-trip on every keystroke deletes the
 * decimal point the moment it is entered. Callers convert with `parseMoney`
 * when they save.
 */
export function MoneyInput({ value, onValueChange, className, ...rest }: MoneyInputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
        $
      </span>
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onValueChange(cleanMoney(e.target.value))}
        className={cn(controlBase, 'pl-7 text-right tabular-nums', className)}
      />
    </div>
  );
}

/** Digits, at most one dot, at most two decimals. */
export function cleanMoney(raw: string): string {
  return raw
    .replace(/[^0-9.]/g, '')
    .replace(/(\..*)\./g, '$1')
    .replace(/(\.\d{2})\d+/, '$1');
}

/** The stored value for a money field, or null when it is blank or unusable. */
export function parseMoney(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Text for a stored money value. The inverse of parseMoney for round-tripping. */
export function moneyText(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}
