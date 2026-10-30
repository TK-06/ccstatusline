import type { Settings } from '../types/Settings';
import type { WidgetItem } from '../types/Widget';
import { isWidgetSpeedWindowEnabled } from '../utils/speed-window';
import { getWidgetCatalog } from '../utils/widgets';

export const CODEXS_VERSION = '1.0.0';
export const CODEXS_STATUSLINE_NAME = 'codexs-statusline';

export interface CodexWidgetSupport {
    state: 'available' | 'pending' | 'unavailable';
    reason: string;
}

const available = [
    'model', 'output-style', 'thinking-effort', 'version', 'current-working-dir',
    'context-length', 'context-window', 'context-percentage', 'context-bar',
    'tokens-input', 'tokens-output', 'session-clock', 'session-usage', 'weekly-usage',
    'reset-timer', 'weekly-reset-timer', 'block-timer', 'terminal-width', 'free-memory',
    'custom-text', 'custom-symbol', 'custom-command', 'link', 'claude-session-id',
    'separator', 'flex-separator',
    'git-branch', 'git-changes', 'git-insertions', 'git-deletions', 'git-staged-files',
    'git-unstaged-files', 'git-untracked-files', 'git-clean-status', 'git-root-dir',
    'git-review', 'git-ci-status', 'git-worktree', 'git-status', 'git-staged',
    'git-unstaged', 'git-untracked', 'git-ahead-behind', 'git-conflicts', 'git-sha',
    'git-origin-owner', 'git-origin-repo', 'git-origin-owner-repo', 'git-upstream-owner',
    'git-upstream-repo', 'git-upstream-owner-repo', 'git-is-fork',
    'jj-bookmarks', 'jj-workspace', 'jj-root-dir', 'jj-changes', 'jj-insertions',
    'jj-deletions', 'jj-description', 'jj-revision'
];
const nativeMapped = [
    'tokens-cached', 'tokens-total', 'cache-hit-rate', 'cache-read',
    'input-speed', 'output-speed', 'total-speed', 'session-name', 'compaction-counter'
];
const nativeReasons: Readonly<Record<string, string>> = {
    'tokens-cached': 'Uses valid native cached-input token totals when supplied; hidden when absent or invalid.',
    'tokens-total': 'Uses valid native total-token counts when supplied; hidden when absent or invalid.',
    'cache-hit-rate': 'Uses valid native input and cached-input counts from the same scope; hidden when absent or invalid.',
    'cache-read': 'Uses valid native cached-input counts for the selected turn or session scope; hidden when absent or invalid.',
    'input-speed': 'Uses valid native token counts and positive matching duration; speed window options are unsupported and hidden.',
    'output-speed': 'Uses valid native token counts and positive matching duration; speed window options are unsupported and hidden.',
    'total-speed': 'Uses valid native token counts and positive matching duration; speed window options are unsupported and hidden.',
    'session-name': 'Uses a valid native thread name after sanitization; hidden when absent or invalid.',
    'compaction-counter': 'Uses a valid native compaction count; trigger split, reclaimed tokens and non-count metric suboptions are unsupported and hidden.'
};
const unavailable = [
    'claude-account-email', 'claude-status', 'session-cost', 'session-cost-rate',
    'extra-usage-utilization', 'extra-usage-remaining', 'extra-usage-used',
    'extra-usage-daily-budget', 'weekly-sonnet-usage', 'weekly-opus-usage',
    'fable-weekly-usage', 'skills', 'voice-status', 'remote-control-status', 'cache-timer',
    'cache-write', 'context-percentage-usable', 'sandbox-status', 'vim-mode',
    'worktree-mode', 'worktree-name', 'worktree-branch', 'worktree-original-branch'
];

export const CODEX_WIDGET_SUPPORT: Readonly<Record<string, CodexWidgetSupport>> = Object.fromEntries<CodexWidgetSupport>([
    ...available.map(type => [type, { state: 'available', reason: 'Uses Codex or local data when available.' }] as const),
    ...nativeMapped.map(type => [type, { state: 'available', reason: nativeReasons[type] ?? 'Uses valid native data when available.' }] as const),
    ...unavailable.map(type => [type, { state: 'unavailable', reason: 'Unavailable: Codex does not supply this widget\'s Claude data or policy.' }] as const)
]);

export function getCodexWidgetSupport(type: string): CodexWidgetSupport {
    return CODEX_WIDGET_SUPPORT[type] ?? { state: 'unavailable', reason: 'Unknown widget' };
}

export function getCodexWidgetCatalog(settings: Settings) {
    return getWidgetCatalog(settings).map((entry) => {
        const support = getCodexWidgetSupport(entry.type);
        return {
            ...entry,
            displayName: entry.type === 'claude-session-id' ? 'Codex Session ID' : entry.displayName,
            description: `${entry.description} ${support.reason}`
        };
    });
}

export function getCodexPreviewLines(lines: WidgetItem[][]): WidgetItem[][] {
    return lines.map(line => line.filter(isCodexWidgetSupported));
}

export function isCodexWidgetSupported(item: WidgetItem): boolean {
    return getCodexWidgetSupport(item.type).state === 'available'
        && (!['input-speed', 'output-speed', 'total-speed'].includes(item.type) || !isWidgetSpeedWindowEnabled(item))
        && (item.type !== 'compaction-counter' || ((!item.metadata?.metric || item.metadata.metric === 'count')
            && item.metadata?.showTriggers !== 'true' && item.metadata?.showReclaimed !== 'true'));
}

export function validateCodexEditorArgs(args: string[]): boolean {
    if (!args.includes('--codex')) {
        return false;
    }
    const index = args.indexOf('--config');
    const configPath = args[index + 1];
    if (index < 0 || !configPath || configPath.startsWith('--')) {
        throw new Error('Codex editor requires an explicit --config file path');
    }
    if (args.includes('--hook')) {
        throw new Error('Claude hooks are unavailable in Codex mode');
    }
    return true;
}
