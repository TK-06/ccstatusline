import {
    expect,
    it
} from 'vitest';

import {
    hasCodexMarker,
    parseCodexExtras,
    sanitizeCodexCommonFields
} from '../codex-input';

it('maps native subset tokens and launch-local speeds without thread-total division', () => {
    expect(parseCodexExtras({ codex: { schema: 1, tokens: { input: 1000, cached_input: 400, output: 200, total: 1200 }, speed_tokens: { input: 100, output: 20, total: 120 }, turn_wall_duration_ms: 2000, compactions: 2, thread_name: 'Synthetic' } })).toMatchObject({ inputTokens: 600, cachedTokens: 400, outputTokens: 200, totalTokens: 1200, compactions: 2, sessionName: 'Synthetic', speed: { inputTokens: 100, outputTokens: 20, totalTokens: 120, totalDurationMs: 2000 } });
});

it.each([undefined, null, '1', 0, 2, true])('requires exactly numeric schema one: %j', (schema) => {
    expect(parseCodexExtras({ codex: { schema, compactions: 3 } })).toBeNull();
});

it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '10', null])('rejects invalid counts independently: %j', (bad) => {
    const parsed = parseCodexExtras({ codex: { schema: 1, tokens: { input: 100, cached_input: bad, output: 20, total: bad }, compactions: bad, thread_name: 'Good' } });
    expect(parsed).toMatchObject({ inputTokens: undefined, cachedTokens: undefined, totalTokens: undefined, outputTokens: 20, compactions: undefined, sessionName: 'Good' });
    expect(parseCodexExtras({ codex: { schema: 1, tokens: { input: bad, cached_input: 0, output: bad, total: 50 }, compactions: 0 } })).toMatchObject({ inputTokens: undefined, cachedTokens: undefined, outputTokens: undefined, totalTokens: 50, compactions: 0 });
});

it('keeps zero and safe integer boundaries and preserves unmarked Claude input identity', () => {
    expect(parseCodexExtras({ codex: { schema: 1, tokens: { input: Number.MAX_SAFE_INTEGER, cached_input: 0, output: 0, total: Number.MAX_SAFE_INTEGER }, compactions: 0 } })).toMatchObject({ inputTokens: Number.MAX_SAFE_INTEGER, cachedTokens: 0, outputTokens: 0, totalTokens: Number.MAX_SAFE_INTEGER, compactions: 0 });
    const claude = { context_window: { used_percentage: 150, context_window_size: 0.5 } };
    expect(sanitizeCodexCommonFields(claude)).toBe(claude);
});

it('rejects a cache count exceeding input and preserves independent native output', () => {
    expect(parseCodexExtras({ codex: { schema: 1, tokens: { input: 10, cached_input: 11, output: 3 } } })).toMatchObject({ cachedTokens: undefined, inputTokens: undefined, outputTokens: 3 });
});

it.each([
    { tokens: { input: 900000, output: 100000, total: 1000000 }, turn_wall_duration_ms: 1000 },
    { speed_tokens: { input: 10, output: 2, total: 12 }, turn_wall_duration_ms: 0 },
    { speed_tokens: { input: 10, output: 2, total: 12 } },
    { speed_tokens: { input: -1, output: NaN, total: 0.5 }, turn_wall_duration_ms: 1000 },
    { turn_wall_duration_ms: 5000 }
])('omits speeds on resume, reset, missing and late-baseline samples: %j', (sample) => {
    expect(parseCodexExtras({ codex: { schema: 1, ...sample } })?.speed).toBeNull();
});

it('preserves an independent output speed when another optional speed count is invalid', () => {
    expect(parseCodexExtras({ codex: { schema: 1, speed_tokens: { input: -1, output: 20, total: 'bad' }, turn_wall_duration_ms: 2000 } })?.speed).toEqual({ inputTokens: undefined, outputTokens: 20, totalTokens: undefined, totalDurationMs: 2000 });
});

it('accepts zero launch deltas and does not retain state across independent launches', () => {
    expect(parseCodexExtras({ codex: { schema: 1, speed_tokens: { input: 0, output: 0, total: 0 }, turn_wall_duration_ms: 1000 } })?.speed).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(parseCodexExtras({ codex: { schema: 1, tokens: { input: 5000 }, turn_wall_duration_ms: 2000 } })?.speed).toBeNull();
});

it('sanitizes native names and rejects nonstrings and blank names', () => {
    expect(parseCodexExtras({ codex: { schema: 1, thread_name: '\u001b]52;c;payload\u0007Safe\u001b[31m name\nnext' } })?.sessionName).toBe('Safe name next');
    for (const thread_name of [null, 7, {}, ' ', '\u001b[31m']) {
        expect(parseCodexExtras({ codex: { schema: 1, thread_name } })?.sessionName).toBeNull();
    }
});

it.each([-1, 100.1, NaN, Infinity])('omits invalid common percentages and absent limits: %j', (bad) => {
    const data = sanitizeCodexCommonFields({ codex: { schema: 1 }, context_window: { used_percentage: bad, remaining_percentage: 25, context_window_size: 1000 } });
    expect(data.context_window?.used_percentage).toBeUndefined();
    expect(data.context_window?.remaining_percentage).toBe(25);
    expect(data.context_window?.current_usage).toBeUndefined();
    expect(data.rate_limits?.five_hour).toBeUndefined();
});

it.each([undefined, -1, 101, NaN, Infinity])('preserves valid native reset independently of missing/invalid usage: %j', (used_percentage) => {
    const resets_at = 2000000000;
    const data = sanitizeCodexCommonFields({ codex: { schema: 1 }, rate_limits: { five_hour: { used_percentage, resets_at }, seven_day: { used_percentage, resets_at } } });
    expect(data.rate_limits?.five_hour).toEqual({ used_percentage: undefined, resets_at });
    expect(data.rate_limits?.seven_day).toEqual({ used_percentage: undefined, resets_at });
});

it.each([undefined, -1, 0.5, NaN, Infinity])('omits invalid native reset independently of valid usage: %j', (resets_at) => {
    const data = sanitizeCodexCommonFields({ codex: { schema: 1 }, rate_limits: { five_hour: { used_percentage: 42, resets_at } } });
    expect(data.rate_limits?.five_hour).toEqual({ used_percentage: 42, resets_at: undefined });
});

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
