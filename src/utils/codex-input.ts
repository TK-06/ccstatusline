import type { StatusJSON } from '../types/StatusJSON';

import { getVisibleText } from './ansi';

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function nativeCount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function nativePercentage(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}

/** Native totals include cache reads; expose uncached input separately for existing widgets. */
export function parseCodexExtras(data: unknown) {
    const extras = record(record(data).codex);
    if (!hasCodexMarker(data) || extras.schema !== 1) {
        return null;
    }
    const tokens = record(extras.tokens);
    const input = nativeCount(tokens.input);
    const cached = nativeCount(tokens.cached_input);
    const cachedTokens = input !== undefined && cached !== undefined && cached <= input ? cached : undefined;
    const speedTokens = record(extras.speed_tokens);
    const duration = nativeCount(extras.turn_wall_duration_ms);
    const speedInput = nativeCount(speedTokens.input);
    const speedOutput = nativeCount(speedTokens.output);
    const speedTotal = nativeCount(speedTokens.total);
    const name = typeof extras.thread_name === 'string'
        ? getVisibleText(extras.thread_name).replace(/[\r\n\t]/g, ' ').trim()
        : '';
    return {
        inputTokens: input !== undefined && cachedTokens !== undefined ? input - cachedTokens : undefined,
        cachedTokens,
        outputTokens: nativeCount(tokens.output),
        totalTokens: nativeCount(tokens.total),
        compactions: nativeCount(extras.compactions),
        sessionName: name || null,
        speed: duration !== undefined && duration > 0 && (speedInput !== undefined || speedOutput !== undefined || speedTotal !== undefined)
            ? { inputTokens: speedInput, outputTokens: speedOutput, totalTokens: speedTotal, totalDurationMs: duration }
            : null
    };
}

/** Keep common native fields strict without changing Claude's coercion/fallback behavior. */
export function sanitizeCodexCommonFields(data: StatusJSON): StatusJSON {
    if (!hasCodexMarker(data)) {
        return data;
    }
    const context = record(data.context_window);
    const usage = record(context.current_usage);
    const currentInput = nativeCount(usage.input_tokens);
    const currentRead = nativeCount(usage.cache_read_input_tokens);
    const capacity = nativeCount(context.context_window_size);
    const periods = record(data.rate_limits);
    const period = (value: unknown) => {
        const fields = record(value);
        const used = nativePercentage(fields.used_percentage);
        const reset = nativeCount(fields.resets_at);
        return used === undefined && reset === undefined ? undefined : { used_percentage: used, resets_at: reset };
    };
    return {
        ...data,
        context_window: {
            context_window_size: capacity !== undefined && capacity > 0 ? capacity : undefined,
            total_input_tokens: nativeCount(context.total_input_tokens),
            total_output_tokens: nativeCount(context.total_output_tokens),
            used_percentage: nativePercentage(context.used_percentage),
            remaining_percentage: nativePercentage(context.remaining_percentage),
            current_usage: typeof context.current_usage === 'number'
                ? nativeCount(context.current_usage)
                : currentInput !== undefined && currentRead !== undefined && Number.isSafeInteger(currentInput + currentRead) ? {
                    input_tokens: currentInput,
                    output_tokens: nativeCount(usage.output_tokens),
                    cache_read_input_tokens: currentRead
                } : undefined
        },
        rate_limits: {
            five_hour: period(periods.five_hour),
            seven_day: period(periods.seven_day)
        }
    };
}

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
