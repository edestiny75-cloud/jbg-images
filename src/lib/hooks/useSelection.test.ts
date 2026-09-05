import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSelection } from './useSelection';

interface Row {
  sku: string;
}

const key = (r: Row) => r.sku;
const a: Row = { sku: 'A' };
const b: Row = { sku: 'B' };
const c: Row = { sku: 'C' };

describe('useSelection', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useSelection(key));
    expect(result.current.count).toBe(0);
    expect(result.current.isSelected(a)).toBe(false);
  });

  it('toggles on and back off', () => {
    const { result } = renderHook(() => useSelection(key));
    act(() => result.current.toggle(a));
    expect(result.current.isSelected(a)).toBe(true);
    act(() => result.current.toggle(a));
    expect(result.current.isSelected(a)).toBe(false);
  });

  it('sets a value explicitly, idempotently', () => {
    const { result } = renderHook(() => useSelection(key));
    act(() => result.current.set(a, true));
    const first = result.current.keys;
    act(() => result.current.set(a, true));
    // Same set instance: a no-op must not force dependents to re-render.
    expect(result.current.keys).toBe(first);
  });

  it('replaces the selection with what is visible', () => {
    const { result } = renderHook(() => useSelection(key));
    act(() => result.current.toggle(c));
    act(() => result.current.selectAll([a, b]));
    expect(result.current.count).toBe(2);
    expect(result.current.isSelected(c)).toBe(false);
  });

  it('clears', () => {
    const { result } = renderHook(() => useSelection(key));
    act(() => result.current.selectAll([a, b, c]));
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });
});
