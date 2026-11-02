import { describe, expect, it } from 'vitest';
import { diffLines } from './text-diff';

describe('diffLines', () => {
  it('marks unchanged, removed, and added chapter lines', () => {
    expect(diffLines('第一行\n旧的一行\n第三行', '第一行\n新的一行\n第三行')).toEqual([
      { kind: 'same', text: '第一行' },
      { kind: 'removed', text: '旧的一行' },
      { kind: 'added', text: '新的一行' },
      { kind: 'same', text: '第三行' },
    ]);
  });
});
