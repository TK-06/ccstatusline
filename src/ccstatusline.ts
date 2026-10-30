#!/usr/bin/env node
import chalk from 'chalk';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    CODEXS_STATUSLINE_NAME,
    CODEXS_VERSION,
    isCodexWidgetSupported,
    validateCodexEditorArgs
} from './tui/codex-profile';
import type { SkillsMetrics } from './types';
import type { RenderContext } from './types/RenderContext';
import type { StatusJSON } from './types/StatusJSON';
import { StatusJSONSchema } from './types/StatusJSON';
import { getVisibleText } from './utils/ansi';
import { prefetchClaudeStatusIfNeeded } from './utils/claude-service-status';
import {
    hasCodexMarker,
    isClaudeOnlyWidgetType,
    parseCodexExtras,
    sanitizeCodexCommonFields
} from './utils/codex-input';
import { updateColorMap } from './utils/colors';
import { ZERO_COMPACTION_STATS } from './utils/compaction';
import {
    getConfigLoadError,
    initConfigPath,
    loadSettings,
    saveSettings
} from './utils/config';
import {
    getContextWindowContextLengthTokens,
    getContextWindowSize
} from './utils/context-window';
import {
    GIT_REVIEW_REFRESH_FLAG,
    refreshGitReviewCacheFromCli
} from './utils/git-review-cache';
import { handleHookInput } from './utils/hook-handler';
import {
    getTranscriptAnalysis,
    normalizeThinkingEffort
} from './utils/jsonl';
import { advanceGlobalPowerlineThemeIndex } from './utils/powerline-theme-index';
import {
    buildConfigWarningBadge,
    calculateMaxWidthsFromPreRendered,
    countPowerlineStartCapSlots,
    preRenderAllWidgets,
    renderStatusLine
} from './utils/renderer';
import { advanceGlobalSeparatorIndex } from './utils/separator-index';
import { getSkillsMetrics } from './utils/skills';
import {
    getWidgetSpeedWindowSeconds,
    isWidgetSpeedWindowEnabled
} from './utils/speed-window';
import {
    getPackageVersion,
    getTerminalWidth
} from './utils/terminal';
import { sanitizeTerminalText } from './utils/terminal-sanitize';
import { prefetchUsageDataIfNeeded } from './utils/usage-prefetch';
import { getUsageWindowFromResetAt } from './utils/usage-windows';
import { ensureWindowsUtf8CodePage } from './utils/windows-code-page';

function hasSessionDurationInStatusJson(data: StatusJSON): boolean {
    const durationMs = data.cost?.total_duration_ms;
    return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0;
}

async function readStdin(): Promise<string | null> {
    // Check if stdin is a TTY (terminal) - if it is, there's no piped data
    if (process.stdin.isTTY) {
        return null;
    }

    const chunks: string[] = [];

    try {
        // Use Node.js compatible approach
        if (typeof Bun !== 'undefined') {
            // Bun environment
            const decoder = new TextDecoder();
            for await (const chunk of Bun.stdin.stream()) {
                chunks.push(decoder.decode(chunk));
            }
        } else {
            // Node.js environment
            process.stdin.setEncoding('utf8');
            for await (const chunk of process.stdin) {
                chunks.push(chunk as string);
            }
        }
        return chunks.join('');
    } catch {
        return null;
    }
}

export async function renderMultipleLines(data: StatusJSON) {
    const codexMarked = hasCodexMarker(data);
    const native = parseCodexExtras(data);
    data = sanitizeCodexCommonFields(data);
    const settings = await loadSettings({ codex: codexMarked });
    const configError = getConfigLoadError();

    // Set global chalk level based on settings
    chalk.level = settings.colorLevel;

    // Update color map after setting chalk level
    updateColorMap();

    // Get all lines to render
    const hasCodexThinkingEffort = typeof data.effort?.level === 'string'
        && normalizeThinkingEffort(data.effort.level) !== undefined;
    let lines = codexMarked
        ? settings.lines.map(line => line.filter(item => !isClaudeOnlyWidgetType(item.type)
            && isCodexWidgetSupported(item)
            && (item.type !== 'context-window' || getContextWindowSize(data) !== null)
            && (item.type !== 'thinking-effort' || hasCodexThinkingEffort)
            && (item.type !== 'tokens-input' || native?.inputTokens !== undefined || data.context_window?.total_input_tokens !== undefined)
            && (item.type !== 'tokens-output' || native?.outputTokens !== undefined || data.context_window?.total_output_tokens !== undefined)
            && (item.type !== 'context-length' || getContextWindowContextLengthTokens(data) !== null)
            && (item.type !== 'tokens-cached' || native?.cachedTokens !== undefined)
            && (item.type !== 'tokens-total' || native?.totalTokens !== undefined)
            && (!['input-speed', 'output-speed', 'total-speed'].includes(item.type) || native?.speed)
            && (item.type !== 'input-speed' || native?.speed?.inputTokens !== undefined)
            && (item.type !== 'output-speed' || native?.speed?.outputTokens !== undefined)
            && (item.type !== 'total-speed' || native?.speed?.totalTokens !== undefined)
            && (item.type !== 'compaction-counter' || native?.compactions !== undefined)
            && (!['cache-hit-rate', 'cache-read'].includes(item.type) || (item.metadata?.cacheScopeSession === 'true'
                ? native?.inputTokens !== undefined && native.cachedTokens !== undefined
                : data.context_window?.current_usage !== undefined))))
        : settings.lines;

    // Check if session clock is needed
    const hasSessionClock = lines.some(line => line.some(item => item.type === 'session-clock'));

    const speedWidgetTypes = new Set(['output-speed', 'input-speed', 'total-speed']);
    const hasSpeedItems = lines.some(line => line.some(item => speedWidgetTypes.has(item.type)));
    const hasCompactionWidget = lines.some(line => line.some(item => item.type === 'compaction-counter'));
    const hasThinkingEffortWidget = lines.some(line => line.some(item => item.type === 'thinking-effort'));
    const hasSessionNameWidget = lines.some(line => line.some(item => item.type === 'session-name'));
    const needsTranscriptThinkingEffort = hasThinkingEffortWidget
        && (!data.effort || !('level' in data.effort));
    const requestedSpeedWindows = new Set<number>();
    for (const line of lines) {
        for (const item of line) {
            if (speedWidgetTypes.has(item.type) && isWidgetSpeedWindowEnabled(item)) {
                requestedSpeedWindows.add(getWidgetSpeedWindowSeconds(item));
            }
        }
    }

    const transcriptAnalysisPromise = !codexMarked && data.transcript_path
        ? getTranscriptAnalysis(data.transcript_path, {
            includeSessionDuration: hasSessionClock && !hasSessionDurationInStatusJson(data),
            includeSpeedMetrics: hasSpeedItems,
            includeSubagents: true,
            speedWindowSeconds: Array.from(requestedSpeedWindows),
            includeCompactionStats: hasCompactionWidget,
            includeThinkingEffort: needsTranscriptThinkingEffort,
            includeSessionName: hasSessionNameWidget
        })
        : Promise.resolve(null);
    const [transcriptAnalysis, usageData, claudeStatusData] = await Promise.all([
        transcriptAnalysisPromise,
        prefetchUsageDataIfNeeded(lines, data),
        codexMarked ? Promise.resolve(null) : prefetchClaudeStatusIfNeeded(lines)
    ]);
    if (codexMarked && !getUsageWindowFromResetAt(usageData?.sessionResetAt)) {
        // Both session timers share a Claude fallback/cache that must never
        // supply a Codex window when the native reset is missing.
        lines = lines.map(line => line.filter(item => item.type !== 'block-timer' && item.type !== 'reset-timer'));
    }

    const tokenMetrics = codexMarked ? {
        inputTokens: native?.inputTokens ?? data.context_window?.total_input_tokens ?? 0,
        outputTokens: native?.outputTokens ?? data.context_window?.total_output_tokens ?? 0,
        cachedTokens: native?.cachedTokens ?? 0,
        cacheReadTokens: native?.cachedTokens ?? 0,
        totalTokens: native?.totalTokens ?? 0,
        // Thread totals are not the current prompt's context length.
        contextLength: 0
    } : transcriptAnalysis?.tokenMetrics ?? null;
    const sessionDuration = transcriptAnalysis?.sessionDuration ?? null;
    // No transcript requests are counted for native samples. Existing speed widgets
    // use only tokens and duration, never requestCount.
    const speedMetrics = codexMarked ? (native?.speed ? {
        inputTokens: native.speed.inputTokens ?? 0,
        outputTokens: native.speed.outputTokens ?? 0,
        totalTokens: native.speed.totalTokens ?? 0,
        totalDurationMs: native.speed.totalDurationMs,
        requestCount: 0
    } : null) : transcriptAnalysis?.speedMetricsCollection?.sessionAverage ?? null;
    const windowedSpeedMetrics = transcriptAnalysis?.speedMetricsCollection?.windowed ?? null;

    let skillsMetrics: SkillsMetrics | null = null;
    if (!codexMarked && data.session_id) {
        skillsMetrics = getSkillsMetrics(data.session_id);
    }

    const compactionData = hasCompactionWidget
        ? (codexMarked ? { ...ZERO_COMPACTION_STATS, count: native?.compactions ?? 0 } : transcriptAnalysis?.compactionData ?? ZERO_COMPACTION_STATS)
        : null;

    // Create render context
    const context: RenderContext = {
        data,
        tokenMetrics,
        speedMetrics,
        windowedSpeedMetrics,
        usageData,
        claudeStatusData,
        sessionDuration,
        transcriptSessionName: hasSessionNameWidget
            ? (codexMarked ? native?.sessionName ?? null : transcriptAnalysis?.sessionName ?? null)
            : undefined,
        transcriptThinkingEffort: needsTranscriptThinkingEffort
            ? (transcriptAnalysis?.thinkingEffort ?? null)
            : undefined,
        skillsMetrics,
        compactionData,
        terminalWidth: getTerminalWidth({
            sessionId: data.session_id,
            ttlSeconds: settings.terminalWidthCacheTtlSeconds
        }),
        isPreview: false,
        minimalist: settings.minimalistMode,
        gitCacheTtlSeconds: settings.gitCacheTtlSeconds,
        customCommandCacheTtlSeconds: settings.customCommandCacheTtlSeconds,
        gitReviewNeedsChecks: lines.some(line => line.some(item => item.type === 'git-ci-status'))
    };

    // Always pre-render all widgets once (for efficiency)
    const preRenderedLines = preRenderAllWidgets(lines, settings, context);
    const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);

    // Render each line using pre-rendered content
    let globalSeparatorIndex = 0;
    let globalPowerlineThemeIndex = 0;
    let globalPowerlineStartCapIndex = 0;
    let configBadgePrepended = false;
    for (let i = 0; i < lines.length; i++) {
        const lineItems = lines[i];
        if (lineItems && lineItems.length > 0) {
            const preRenderedWidgets = preRenderedLines[i] ?? [];
            const lineContext = {
                ...context,
                lineIndex: i,
                globalSeparatorIndex,
                globalPowerlineThemeIndex,
                globalPowerlineStartCapIndex
            };
            let line = renderStatusLine(lineItems, settings, lineContext, preRenderedWidgets, preCalculatedMaxWidths);

            // Only output the line if it has content (not just ANSI codes)
            // Strip ANSI codes to check if there's actual text
            const strippedLine = getVisibleText(line).trim();
            if (strippedLine.length > 0) {
                if (configError && !configBadgePrepended) {
                    // On the error path settings are always inMemoryDefaults(), whose separators render as ' | '.
                    line = `${buildConfigWarningBadge(settings.colorLevel)} | ${line}`;
                    configBadgePrepended = true;
                }

                // Replace all spaces with non-breaking spaces to prevent VSCode trimming
                // The renderer's own output is colors and links; this is the last
                // stop before the terminal for anything else (separators, settings)
                let outputLine = sanitizeTerminalText(line).replace(/ /g, '\u00A0');

                // Add reset code at the beginning to override Claude Code's dim setting
                outputLine = '\x1b[0m' + outputLine;
                console.log(outputLine);

                globalSeparatorIndex = advanceGlobalSeparatorIndex(globalSeparatorIndex, lineItems, preRenderedWidgets);
                if (settings.powerline.enabled) {
                    globalPowerlineStartCapIndex += countPowerlineStartCapSlots(lineItems, preRenderedWidgets);
                }
                if (settings.powerline.enabled && settings.powerline.continueThemeAcrossLines) {
                    globalPowerlineThemeIndex = advanceGlobalPowerlineThemeIndex(globalPowerlineThemeIndex, preRenderedWidgets);
                }
            }
        }
    }

    // Defensive fallback: if no content line was emitted, ensure the warning is not lost
    if (configError && !configBadgePrepended) {
        console.log('\x1b[0m' + buildConfigWarningBadge(settings.colorLevel).replace(/ /g, '\u00A0'));
    }

    // Check if there's an update message to display
    if (!codexMarked && settings.updatemessage?.message
        && settings.updatemessage.message.trim() !== ''
        && settings.updatemessage.remaining
        && settings.updatemessage.remaining > 0) {
        // Display the message
        console.log(sanitizeTerminalText(settings.updatemessage.message));

        // Decrement the remaining count
        const newRemaining = settings.updatemessage.remaining - 1;

        // Update or remove the updatemessage
        if (newRemaining <= 0) {
            // Remove the entire updatemessage block
            const { updatemessage, ...newSettings } = settings;
            await saveSettings(newSettings);
        } else {
            // Update the remaining count
            await saveSettings({
                ...settings,
                updatemessage: {
                    ...settings.updatemessage,
                    remaining: newRemaining
                }
            });
        }
    }
}

function parseConfigArg(): string | undefined {
    const idx = process.argv.indexOf('--config');
    if (idx === -1)
        return undefined;
    const configPath = process.argv[idx + 1];
    if (!configPath || configPath.startsWith('--')) {
        console.error('--config requires a file path argument');
        process.exit(1);
    }
    process.argv.splice(idx, 2);
    return configPath;
}

async function handleHook(): Promise<void> {
    const input = await readStdin();
    handleHookInput(input);
}

function handleGitReviewRefresh(): boolean {
    const flagIndex = process.argv.indexOf(GIT_REVIEW_REFRESH_FLAG);
    if (flagIndex === -1) {
        return false;
    }

    const cwd = process.argv[flagIndex + 1];
    const mode = process.argv[flagIndex + 2];
    const lockPath = process.argv[flagIndex + 3];
    if (!cwd || (mode !== 'metadata' && mode !== 'checks') || !lockPath) {
        return true;
    }

    refreshGitReviewCacheFromCli(cwd, { includeChecks: mode === 'checks' }, lockPath);
    return true;
}

async function main() {
    if (process.argv.includes('--codex') && (process.argv.includes('--version') || process.argv.includes('-V'))) {
        console.log(`${CODEXS_STATUSLINE_NAME} ${CODEXS_VERSION}`);
        return;
    }
    // Detached cache refreshes re-enter this executable without reading stdin
    // or loading user settings. This mode intentionally emits no output.
    if (handleGitReviewRefresh()) {
        return;
    }

    // Print version and exit (#461). Standard CLI behavior, runs before any other mode.
    if (process.argv.includes('--version')) {
        console.log(getPackageVersion());
        process.exit(0);
    }

    const codex = validateCodexEditorArgs(process.argv.slice(2));
    if (codex && !process.stdin.isTTY) {
        throw new Error('The Codex editor requires an interactive terminal');
    }

    // Parse --config before anything else
    initConfigPath(parseConfigArg());

    // Handle --hook mode (cross-platform hook handler for widgets)
    if (process.argv.includes('--hook')) {
        await handleHook();
        return;
    }

    // Check if we're in a piped/non-TTY environment first
    if (!process.stdin.isTTY) {
        ensureWindowsUtf8CodePage();

        // We're receiving piped input
        const input = await readStdin();
        if (input && input.trim() !== '') {
            try {
                // Parse and validate JSON in one step
                const rawData: unknown = JSON.parse(input);
                const result = StatusJSONSchema.safeParse(hasCodexMarker(rawData)
                    ? sanitizeCodexCommonFields(rawData as StatusJSON)
                    : rawData);
                if (!result.success) {
                    console.error('Invalid status JSON format:', result.error.message);
                    process.exit(1);
                }

                await renderMultipleLines(result.data);
            } catch (error) {
                console.error('Error parsing JSON:', error);
                process.exit(1);
            }
        } else {
            console.error('No input received');
            process.exit(1);
        }
    } else {
        // Interactive mode - run TUI
        // Remove updatemessage before running TUI
        const settings = await loadSettings({ codex });
        if (settings.updatemessage) {
            const { updatemessage, ...newSettings } = settings;
            await saveSettings(newSettings, { codex });
        }
        // Imported lazily: the TUI pulls in ink/React/yoga-layout, which the
        // status line render path never touches. Claude Code re-runs this
        // binary every couple of seconds, so keeping that graph off the
        // render path is worth the dynamic import here.
        const { runTUI } = await import('./tui');
        runTUI({ codex });
    }
}

function isCommandEntry(): boolean {
    if (!process.argv[1]) {
        return false;
    }

    // Resolve package-manager symlinks as well as direct source/dist invocations.
    // An unrelated missing argv path is normal when this module is imported.
    try {
        const invokedPath = realpathSync(path.resolve(process.argv[1]));
        const modulePath = realpathSync(fileURLToPath(import.meta.url));
        return process.platform === 'win32'
            ? invokedPath.toLowerCase() === modulePath.toLowerCase()
            : invokedPath === modulePath;
    } catch {
        return false;
    }
}

if (isCommandEntry()) {
    void main();
}
