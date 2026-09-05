import { describe, expect, it } from 'vitest';
import { bearerMatches } from './bearer';

const TOKEN = 'a'.repeat(64);

describe('bearerMatches', () => {
  it('accepts the configured token', () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it('tolerates trailing whitespace from a shell that added it', () => {
    expect(bearerMatches(`Bearer ${TOKEN}  `, TOKEN)).toBe(true);
  });

  it('rejects a different token of the same length', () => {
    expect(bearerMatches(`Bearer ${'b'.repeat(64)}`, TOKEN)).toBe(false);
  });

  it('rejects a token of a different length rather than throwing', () => {
    // timingSafeEqual throws on mismatched buffers; hashing first is what stops
    // an exception from becoming the answer.
    expect(() => bearerMatches('Bearer short', TOKEN)).not.toThrow();
    expect(bearerMatches('Bearer short', TOKEN)).toBe(false);
  });

  it('rejects a prefix of the real token', () => {
    expect(bearerMatches(`Bearer ${TOKEN.slice(0, 32)}`, TOKEN)).toBe(false);
  });

  it('requires the Bearer scheme', () => {
    expect(bearerMatches(TOKEN, TOKEN)).toBe(false);
    expect(bearerMatches(`Basic ${TOKEN}`, TOKEN)).toBe(false);
    // Schemes are case-sensitive here on purpose: the agent is the only client.
    expect(bearerMatches(`bearer ${TOKEN}`, TOKEN)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(bearerMatches(null, TOKEN)).toBe(false);
    expect(bearerMatches(undefined, TOKEN)).toBe(false);
  });

  it('fails closed when no token is configured', () => {
    // An unconfigured deployment must refuse the agent, not admit everyone.
    expect(bearerMatches(`Bearer ${TOKEN}`, undefined)).toBe(false);
    expect(bearerMatches(`Bearer ${TOKEN}`, '')).toBe(false);
    expect(bearerMatches('Bearer ', '')).toBe(false);
  });

  it('rejects an empty token even when one is configured', () => {
    expect(bearerMatches('Bearer ', TOKEN)).toBe(false);
    expect(bearerMatches('Bearer    ', TOKEN)).toBe(false);
  });
});
