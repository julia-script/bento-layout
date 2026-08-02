import { describe, expect, it } from 'vitest';
import { positionalArg } from '../scripts/fuzz/cli.js';

describe('fuzz CLI argument parsing', () => {
  it('does not mistake a value-flag argument for the positional input', () => {
    expect(positionalArg(['--cluster', '2'], new Set(['--cluster']))).toBeUndefined();
    expect(positionalArg(['batch.json', '--cluster', '2'], new Set(['--cluster']))).toBe('batch.json');
  });
});
