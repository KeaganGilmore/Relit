import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, map, mapErr, ok, unwrap } from './result.js';

describe('Result', () => {
  it('ok carries a value', () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('err carries an error', () => {
    const r = err('boom');
    expect(isErr(r)).toBe(true);
    if (!r.ok) expect(r.error).toBe('boom');
  });

  it('map transforms ok, leaves err alone', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err<string>('e'), (n: number) => n * 3)).toEqual(err('e'));
  });

  it('mapErr transforms err, leaves ok alone', () => {
    expect(mapErr(err('e'), (e) => `${e}!`)).toEqual(err('e!'));
    expect(mapErr(ok(1), (e: string) => `${e}!`)).toEqual(ok(1));
  });

  it('unwrap returns ok value or throws', () => {
    expect(unwrap(ok('x'))).toBe('x');
    expect(() => unwrap(err('bad'))).toThrow(/unwrap on Err/);
  });
});
