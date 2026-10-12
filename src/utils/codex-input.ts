// The Codex marker is deliberately independent of extras schema validation.
export function hasCodexMarker(value: unknown): boolean {
    return value !== null
        && typeof value === 'object'
        && Object.prototype.hasOwnProperty.call(value, 'codex');
}

// These widgets require Claude-specific services or values that Codex does not
// supply. Filter them before computing render needs or invoking any prefetcher.
const CLAUDE_ONLY_WIDGET_TYPES = new Set([
    'claude-status',
    'claude-account-email',
    'extra-usage-utilization',
    'extra-usage-remaining',
    'extra-usage-used',
    'extra-usage-daily-budget',
    'weekly-opus-usage',
    'weekly-sonnet-usage',
    'fable-weekly-usage',
    'remote-control-status',
    'voice-status',
    'skills',
    'cache-timer',
    'session-cost',
    'session-cost-rate'
]);

export function isClaudeOnlyWidgetType(type: string): boolean {
    return CLAUDE_ONLY_WIDGET_TYPES.has(type);
}
