export type CollisionStrategy = 'skip' | 'overwrite' | 'number';

export interface OutputNameOptions {
  readonly suffix?: string;
  readonly extension?: string;
  readonly collision?: CollisionStrategy;
}

export interface NameDecision {
  readonly name: string;
  readonly action: 'write' | 'skip';
}

const splitExt = (name: string): { readonly stem: string; readonly ext: string } => {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
};

/**
 * Pure function: given an input filename + config, decide the output name.
 * Caller checks `outputExists` only when collision !== 'overwrite'; this
 * function takes that result back as `existsCheck`.
 *
 * Examples:
 *   plan('a.jpg', { suffix: '_relit' })            → 'a_relit.jpg'
 *   plan('a.jpg', { extension: '.png' })           → 'a.png'
 *   plan('a.jpg', { collision: 'skip', existsCheck: () => true }) → action: 'skip'
 *   plan('a.jpg', { collision: 'number', existsCheck: name => name === 'a.jpg' }) → 'a (1).jpg'
 */
export const planOutputName = (
  inputName: string,
  options: OutputNameOptions,
  existsCheck: (name: string) => boolean,
): NameDecision => {
  const { stem, ext: origExt } = splitExt(inputName);
  const ext = options.extension ?? origExt;
  const base = `${stem}${options.suffix ?? ''}${ext}`;
  const collision = options.collision ?? 'number';

  if (!existsCheck(base)) return { name: base, action: 'write' };

  if (collision === 'overwrite') return { name: base, action: 'write' };
  if (collision === 'skip') return { name: base, action: 'skip' };

  // 'number' — append (1), (2), ...
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${stem}${options.suffix ?? ''} (${i})${ext}`;
    if (!existsCheck(candidate)) return { name: candidate, action: 'write' };
  }
  // Pathological — give up and overwrite the base name to avoid infinite work.
  return { name: base, action: 'write' };
};
