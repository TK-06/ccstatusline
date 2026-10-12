import {
    expect,
    it
} from 'vitest';

import { hasCodexMarker } from '../codex-input';

it.each([
    [{ codex: { schema: 1 } }, true],
    [{ codex: { schema: 1, tokens: 'malformed' } }, true],
    [{ codex: { schema: 2 } }, true],
    [{ codex: null }, true],
    [{ codex: 'not-an-object' }, true],
    [{ model: { id: 'claude' } }, false],
    [Object.create({ codex: { schema: 1 } }), false],
    [null, false]
])('protects precisely when the input owns a codex key: %j', (input, expected) => {
    expect(hasCodexMarker(input)).toBe(expected);
});
