import { describe, expect, it } from 'vitest';
import { planOutputName } from './output-namer.js';

const never = () => false;

describe('planOutputName', () => {
  it('appends suffix and keeps extension by default', () => {
    expect(planOutputName('a.jpg', { suffix: '_relit' }, never)).toEqual({
      name: 'a_relit.jpg',
      action: 'write',
    });
  });

  it('respects extension override', () => {
    expect(planOutputName('a.jpg', { extension: '.png' }, never)).toEqual({
      name: 'a.png',
      action: 'write',
    });
  });

  it('handles names with no extension', () => {
    expect(planOutputName('photo', { suffix: '_x' }, never)).toEqual({
      name: 'photo_x',
      action: 'write',
    });
  });

  it('handles dotfiles (lastIndexOf 0 means no real extension)', () => {
    expect(planOutputName('.hidden', { suffix: '_x' }, never)).toEqual({
      name: '.hidden_x',
      action: 'write',
    });
  });

  it('skip strategy returns action=skip when target exists', () => {
    const r = planOutputName('a.jpg', { collision: 'skip' }, (n) => n === 'a.jpg');
    expect(r).toEqual({ name: 'a.jpg', action: 'skip' });
  });

  it('overwrite strategy writes to the base name even when it exists', () => {
    const r = planOutputName('a.jpg', { collision: 'overwrite' }, () => true);
    expect(r).toEqual({ name: 'a.jpg', action: 'write' });
  });

  it('number strategy increments until a free slot is found', () => {
    const taken = new Set(['a_r.jpg', 'a_r (1).jpg', 'a_r (2).jpg']);
    const r = planOutputName('a.jpg', { suffix: '_r', collision: 'number' }, (n) => taken.has(n));
    expect(r).toEqual({ name: 'a_r (3).jpg', action: 'write' });
  });

  it('default collision is number', () => {
    const r = planOutputName('a.jpg', {}, (n) => n === 'a.jpg');
    expect(r).toEqual({ name: 'a (1).jpg', action: 'write' });
  });
});
