import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    fileURLToPath,
    pathToFileURL
} from 'node:url';
import {
    afterEach,
    expect,
    it,
    vi
} from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isIsolatedChild = process.env.CODEXS_TASK0A_CHILD === '1';

// Captured from the unmodified 2.2.32 formatter on 2026-10-11. SHA-256:
// 89A446F1DDF82FD0437FC386214C0F7193D163B9DC5173E89FF1219F715BAC5B
const expectedClaudeOutput = Buffer.from(
    'G1swbU1vZGVsOsKgT3B1c8KgNC42wqB8wqBUaGlua2luZzrCoGhpZ2jCoHzCoFN0eWxlOsKgZGVmYXVsdMKgfMKgQ3R4wqBVc2VkOsKgOC4wJcKgfMKgSW46wqA1MC4xa8KgfMKgdjIuMS44MMKgfMKg4peGCg==',
    'base64'
);

// This literal matches the Claude-specific entries in the actual widget registry.
const claudeOnlyTypes = [
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
] as const;

const safetyCases = [
    { marker: { codex: { schema: 1, tokens: { input: 1000, cached_input: 400, output: 200, total: 1200 }, speed_tokens: { input: 100, output: 20, total: 120 }, turn_wall_duration_ms: 2000, compactions: 2, thread_name: 'Synthetic' } }, withLimits: false, effort: undefined, expectedEffort: null },
    { marker: { codex: { schema: 1 } }, withLimits: true, effort: undefined, expectedEffort: null },
    { marker: { codex: { schema: 1, tokens: 'malformed' } }, withLimits: true, effort: undefined, expectedEffort: null },
    { marker: { codex: { schema: 2 } }, withLimits: true, effort: undefined, expectedEffort: null },
    { marker: { codex: null }, withLimits: true, effort: undefined, expectedEffort: null },
    { marker: { codex: 'invalid' }, withLimits: true, effort: undefined, expectedEffort: null },
    { marker: { codex: { schema: 1 } }, withLimits: false, effort: undefined, expectedEffort: null },
    { marker: { codex: { schema: 1 } }, withLimits: true, effort: { level: null }, expectedEffort: null },
    { marker: { codex: { schema: 1 } }, withLimits: true, effort: { level: '???' }, expectedEffort: null },
    { marker: { codex: { schema: 1 } }, withLimits: true, effort: { level: 'bad value' }, expectedEffort: null },
    { marker: { codex: { schema: 1 } }, withLimits: true, effort: { level: '\u001b[31m' }, expectedEffort: null },
    { marker: { codex: { schema: 1 } }, withLimits: true, effort: { level: 'high' }, expectedEffort: 'high' },
    { marker: { codex: { schema: 1 } }, withLimits: true, effort: { level: 'xhigh' }, expectedEffort: 'xhigh' },
    { marker: { codex: { schema: 1 } }, withLimits: true, effort: { level: 'ultra-boost' }, expectedEffort: 'ultra-boost?' }
] as const;

const codexUnavailableTypes = [...claudeOnlyTypes, 'sandbox-status', 'context-percentage-usable', 'cache-write', 'vim-mode', 'worktree-mode', 'worktree-name', 'worktree-branch', 'worktree-original-branch'];

if (isIsolatedChild) {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders native timer-only windows independently of usage with no Claude fallback', async () => {
        const { renderMultipleLines } = await import('../ccstatusline');
        const config = await import('../utils/config');
        const jsonl = await import('../utils/jsonl');
        const usage = await import('../utils/usage');
        const { DEFAULT_SETTINGS } = await import('../types/Settings');
        const { getWidget } = await import('../utils/widgets');
        vi.spyOn(config, 'loadSettings').mockResolvedValue({ ...DEFAULT_SETTINGS, colorLevel: 0, lines: [[{ id: 'block', type: 'block-timer' }], [{ id: 'reset', type: 'reset-timer' }], [{ id: 'weekly', type: 'weekly-reset-timer' }]] });
        const blockWidget = getWidget('block-timer');
        const resetWidget = getWidget('reset-timer');
        const weeklyWidget = getWidget('weekly-reset-timer');
        if (!blockWidget || !resetWidget || !weeklyWidget) {
            throw new Error('Missing registered timer widgets');
        }
        const block = vi.spyOn(blockWidget, 'render');
        const reset = vi.spyOn(resetWidget, 'render');
        const weekly = vi.spyOn(weeklyWidget, 'render');
        const cachedBlock = vi.spyOn(jsonl, 'getCachedBlockMetrics');
        const fetch = vi.spyOn(usage, 'fetchUsageData');
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const resets_at = Math.floor(Date.now() / 1000) + 10800;
        for (const used_percentage of [undefined, -1, 101, NaN]) {
            block.mockClear();
            reset.mockClear();
            weekly.mockClear();
            await renderMultipleLines({ codex: { schema: 1 }, rate_limits: { five_hour: { used_percentage, resets_at }, seven_day: { used_percentage, resets_at } } });
            expect(block).toHaveBeenCalledOnce();
            expect(reset).toHaveBeenCalledOnce();
            expect(weekly).toHaveBeenCalledOnce();
            expect(block.mock.results[0]?.value).not.toBeNull();
            expect(reset.mock.results[0]?.value).not.toBeNull();
            expect(weekly.mock.results[0]?.value).not.toBeNull();
            expect(block.mock.calls[0]?.[1].usageData?.sessionUsage).toBeUndefined();
            expect(block.mock.calls[0]?.[1].usageData?.sessionResetAt).toBe(new Date(resets_at * 1000).toISOString());
            expect(weekly.mock.calls[0]?.[1].usageData?.weeklyResetAt).toBe(new Date(resets_at * 1000).toISOString());
        }
        for (const invalidReset of [undefined, -1, 0.5, NaN, Infinity]) {
            block.mockClear();
            reset.mockClear();
            await renderMultipleLines({ codex: { schema: 1 }, rate_limits: { five_hour: { used_percentage: 42, resets_at: invalidReset }, seven_day: { used_percentage: 42, resets_at: invalidReset } } });
            expect(block).not.toHaveBeenCalled();
            expect(reset).not.toHaveBeenCalled();
        }
        block.mockClear();
        reset.mockClear();
        weekly.mockClear();
        await renderMultipleLines({ codex: null, rate_limits: { seven_day: { resets_at } } });
        expect(block).not.toHaveBeenCalled();
        expect(reset).not.toHaveBeenCalled();
        expect(weekly).toHaveBeenCalledOnce();
        expect(weekly.mock.results[0]?.value).not.toBeNull();
        expect(cachedBlock).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('preserves timer-only native resets in raw CLI input while rejecting malformed usage', () => {
        const isolatedHome = process.env.CODEXS_TASK0A_DIR;
        if (!isolatedHome) {
            throw new Error('Missing isolated home');
        }
        const configPath = path.join(isolatedHome, 'timer-only-config.json');
        fs.writeFileSync(configPath, JSON.stringify({ version: 4, colorLevel: 0, lines: [[{ id: 'block', type: 'block-timer' }], [{ id: 'reset', type: 'reset-timer' }]] }));
        const executable = typeof Bun === 'undefined' ? (process.env.CODEXS_BASELINE_BUN ?? 'bun') : process.execPath;
        for (const used_percentage of [undefined, 'bad', 101]) {
            const result = spawnSync(executable, ['run', path.join(projectRoot, 'src', 'ccstatusline.ts'), '--config', configPath], {
                input: JSON.stringify({ codex: { schema: 1 }, rate_limits: { five_hour: { used_percentage, resets_at: Math.floor(Date.now() / 1000) + 10800 } } }),
                env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(isolatedHome, '.claude'), CLAUDE_SECURESTORAGE_CONFIG_DIR: path.join(isolatedHome, '.claude') },
                encoding: 'utf8', windowsHide: true, timeout: 15000
            });
            expect(result.stderr).toBe('');
            expect(result.status).toBe(0);
            expect(result.stdout.trim().split('\n')).toHaveLength(2);
            expect(result.stdout).not.toContain('bad');
            expect(result.stdout).not.toContain('101');
        }
    });

    it('validates native common fields before Claude numeric coercion in the CLI', () => {
        const isolatedHome = process.env.CODEXS_TASK0A_DIR;
        if (!isolatedHome) {
            throw new Error('Missing isolated home');
        }
        const executable = typeof Bun === 'undefined' ? (process.env.CODEXS_BASELINE_BUN ?? 'bun') : process.execPath;
        const result = spawnSync(executable, ['run', path.join(projectRoot, 'src', 'ccstatusline.ts'), '--config', path.join(isolatedHome, 'config.json')], {
            input: JSON.stringify({ codex: { schema: 1 }, rate_limits: { five_hour: { used_percentage: '42' } } }),
            env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(isolatedHome, '.claude'), CLAUDE_SECURESTORAGE_CONFIG_DIR: path.join(isolatedHome, '.claude') },
            encoding: 'utf8', windowsHide: true, timeout: 15000
        });
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('SAFE-CODEX');
        expect(result.stdout).not.toContain('42');
    });

    it('renders native metrics through the activated catalog and omits unsupported suboptions', async () => {
        const { renderMultipleLines } = await import('../ccstatusline');
        const config = await import('../utils/config');
        const jsonl = await import('../utils/jsonl');
        const { DEFAULT_SETTINGS } = await import('../types/Settings');
        const types = ['tokens-input', 'tokens-output', 'tokens-cached', 'tokens-total', 'cache-hit-rate', 'cache-read', 'input-speed', 'output-speed', 'total-speed', 'session-name', 'compaction-counter'];
        const lines = types.map(type => [{ id: type, type, metadata: type === 'compaction-counter' ? { format: 'text-and-number' } : undefined }]);
        vi.spyOn(config, 'loadSettings').mockResolvedValue({ ...DEFAULT_SETTINGS, colorLevel: 0, lines });
        const transcript = vi.spyOn(jsonl, 'getTranscriptAnalysis');
        const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const data = { codex: { schema: 1, tokens: { input: 1000, cached_input: 400, output: 200, total: 1200 }, speed_tokens: { input: 100, output: 20, total: 120 }, turn_wall_duration_ms: 2000, compactions: 2, thread_name: '\u001b[31mSynthetic' }, context_window: { current_usage: { input_tokens: 300, cache_read_input_tokens: 100 } } };
        await renderMultipleLines(data);
        const rendered = output.mock.calls.map(call => String(call[0])).join('\n').replace(/\u00a0/g, ' ');
        for (const expected of ['In: 600', 'Out: 200', 'Cached: 400', 'Total: 1.2k', 'Cache Hit: 25.0%', 'Cache Read: 100 (25.0%)', 'In: 50.0 t/s', 'Out: 10.0 t/s', 'Total: 60.0 t/s', 'Session: Synthetic', 'Compactions: 2']) {
            expect(rendered).toContain(expected);
        }
        expect(transcript).not.toHaveBeenCalled();
        output.mockClear();
        const settings = await config.loadSettings();
        settings.lines = [
            [{ id: 'window', type: 'input-speed', metadata: { windowSeconds: '30' } }],
            [{ id: 'triggers', type: 'compaction-counter', metadata: { showTriggers: 'true' } }],
            [{ id: 'reclaimed', type: 'compaction-counter', metadata: { metric: 'reclaimed' } }],
            [{ id: 'reclaimed-suffix', type: 'compaction-counter', metadata: { showReclaimed: 'true' } }]
        ];
        const unsupportedBefore = structuredClone(settings.lines);
        await renderMultipleLines(data);
        expect(output).not.toHaveBeenCalled();
        expect(settings.lines).toEqual(unsupportedBefore);
        settings.lines = [[{ id: 'cumulative', type: 'input-speed', metadata: { windowSeconds: '0', future: 'retained' } }]];
        const cumulativeBefore = structuredClone(settings.lines);
        await renderMultipleLines(data);
        expect(output.mock.calls.map(call => String(call[0])).join('\n').replace(/\u00a0/g, ' ')).toContain('50.0 t/s');
        expect(settings.lines).toEqual(cumulativeBefore);
        output.mockClear();
        settings.lines = types.map(type => [{ id: type, type, metadata: type === 'compaction-counter' ? { format: 'text-and-number' } : undefined }]);
        await renderMultipleLines({ ...data, codex: { schema: 1, tokens: { output: 7 }, speed_tokens: { input: -1, output: 20 }, turn_wall_duration_ms: 2000 } });
        const partial = output.mock.calls.map(call => String(call[0])).join('\n').replace(/\u00a0/g, ' ');
        expect(partial).toContain('Out: 7');
        expect(partial).toContain('Out: 10.0 t/s');
        expect(partial).not.toContain('Cached:');
        expect(partial).not.toContain('Total:');
        expect(partial).not.toContain('Compactions:');
        expect(partial).not.toContain('Session:');
    });

    it('preserves independent common totals for malformed extras and omits unknown prompt length', async () => {
        const { renderMultipleLines } = await import('../ccstatusline');
        const config = await import('../utils/config');
        const { DEFAULT_SETTINGS } = await import('../types/Settings');
        vi.spyOn(config, 'loadSettings').mockResolvedValue({ ...DEFAULT_SETTINGS, colorLevel: 0, lines: [[{ id: 'in', type: 'tokens-input' }], [{ id: 'out', type: 'tokens-output' }], [{ id: 'context', type: 'context-length' }]] });
        const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        for (const codex of [null, { schema: 2 }, { schema: 1, tokens: 'bad' }]) {
            output.mockClear();
            await renderMultipleLines({ codex, context_window: { total_input_tokens: 100, total_output_tokens: 20 } });
            const rendered = output.mock.calls.map(call => String(call[0])).join('\n').replace(/\u00a0/g, ' ');
            expect(rendered).toContain('In: 100');
            expect(rendered).toContain('Out: 20');
            expect(rendered).not.toContain('Ctx:');
            expect(output).toHaveBeenCalledTimes(2);
        }
    });

    it.each(safetyCases)('suppresses every Claude-only widget and reader for Codex marker %j', async ({ marker, withLimits, effort, expectedEffort }) => {
        const isolatedHome = process.env.CODEXS_TASK0A_DIR;
        if (!isolatedHome || fs.realpathSync(os.homedir()) !== fs.realpathSync(isolatedHome)) {
            throw new Error('Isolated home precheck failed before formatter import');
        }
        if (process.env.CLAUDE_CONFIG_DIR !== isolatedHome
            || process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR !== isolatedHome) {
            throw new Error('Isolated Claude directory precheck failed before formatter import');
        }

        const networkRequest = vi.spyOn(https, 'request').mockImplementation(() => {
            throw new Error('Blocked test HTTPS request');
        });
        expect(() => https.request('https://example.invalid')).toThrow('Blocked test HTTPS request');
        networkRequest.mockClear();

        const { renderMultipleLines } = await import('../ccstatusline');
        const config = await import('../utils/config');
        const claudeSettings = await import('../utils/claude-settings');
        const claudeStatus = await import('../utils/claude-service-status');
        const jsonl = await import('../utils/jsonl');
        const skills = await import('../utils/skills');
        const usage = await import('../utils/usage');
        const { getWidget } = await import('../utils/widgets');
        const { WIDGET_MANIFEST } = await import('../utils/widget-manifest');
        expect(claudeOnlyTypes.every(type => WIDGET_MANIFEST.some(entry => entry.type === type))).toBe(true);
        expect(path.resolve(claudeSettings.getClaudeJsonPath()))
            .toBe(path.join(isolatedHome, '.claude.json'));

        config.initConfigPath(path.join(isolatedHome, 'config.json'));
        const settings = await config.loadSettings();
        const originalLines = JSON.stringify(settings.lines);
        vi.spyOn(config, 'loadSettings').mockResolvedValue(settings);
        const transcriptRead = vi.spyOn(jsonl, 'getTranscriptAnalysis');
        const cachedBlockRead = vi.spyOn(jsonl, 'getCachedBlockMetrics').mockReturnValue({ startTime: new Date(Date.now() - 60000), lastActivity: new Date() });
        const statusRead = vi.spyOn(claudeStatus, 'prefetchClaudeStatusIfNeeded').mockResolvedValue(null);
        const skillsRead = vi.spyOn(skills, 'getSkillsMetrics').mockReturnValue({ totalInvocations: 0, uniqueSkills: [], lastSkill: null });
        const accountRead = vi.spyOn(claudeSettings, 'getClaudeJsonPath');
        const usageFetch = vi.spyOn(usage, 'fetchUsageData').mockResolvedValue({ sessionUsage: 99 });
        const credentialFileRead = vi.spyOn(fs, 'readFileSync');
        fs.readFileSync(path.join(isolatedHome, '.claude.json'), 'utf8');
        expect(credentialFileRead).toHaveBeenCalled();
        credentialFileRead.mockClear();
        const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const claudeRenderSpies = [...codexUnavailableTypes, 'block-timer'].map((type) => {
            const widget = getWidget(type);
            if (!widget) {
                throw new Error(`Missing registered widget ${type}`);
            }
            return vi.spyOn(widget, 'render');
        });

        await renderMultipleLines({
            ...marker,
            session_id: 'codex-session',
            transcript_path: path.join(isolatedHome, 'transcript.jsonl'),
            effort,
            rate_limits: withLimits ? { five_hour: { used_percentage: 42 } } : undefined
        });

        const rendered = output.mock.calls.map(call => String(call[0])).join('\n');
        expect(rendered).toContain('SAFE-CODEX');
        expect(rendered).not.toContain('Win:');
        if (expectedEffort) {
            expect(rendered).toContain(`Thinking:\u00a0${expectedEffort}`);
        } else {
            expect(rendered).not.toContain('Thinking:');
        }
        expect(credentialFileRead.mock.calls.some(call => path.resolve(String(call[0])) === path.join(isolatedHome, 'settings.json'))).toBe(false);
        if (withLimits) {
            expect(rendered).toContain('42');
        } else {
            expect(rendered).not.toContain('99');
        }
        expect(claudeRenderSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
        expect(transcriptRead).not.toHaveBeenCalled();
        expect(cachedBlockRead).not.toHaveBeenCalled();
        expect(statusRead).not.toHaveBeenCalled();
        expect(skillsRead).not.toHaveBeenCalled();
        expect(accountRead).not.toHaveBeenCalled();
        expect(usageFetch).not.toHaveBeenCalled();
        expect(networkRequest).not.toHaveBeenCalled();
        expect(credentialFileRead.mock.calls.some(call => path.resolve(String(call[0])) === path.join(isolatedHome, '.claude.json'))).toBe(false);
        expect(JSON.stringify(settings.lines)).toBe(originalLines);
        output.mockClear();
        await renderMultipleLines({ ...marker, context_window: { context_window_size: 500000 } });
        expect(output.mock.calls.map(call => String(call[0])).join('\n')).toContain('Win:\u00a0500.0k');
        await renderMultipleLines({ ...marker, rate_limits: { five_hour: { used_percentage: 42, resets_at: Math.floor(Date.now() / 1000) + 10800 } } });
        expect(claudeRenderSpies.at(-1)).toHaveBeenCalledOnce();
        expect(cachedBlockRead).not.toHaveBeenCalled();
    });
    it('refuses a protected Claude config before loading Codex render settings', async () => {
        const isolatedHome = process.env.CODEXS_TASK0A_DIR;
        if (!isolatedHome) {
            throw new Error('Missing isolated home');
        }
        const config = await import('../utils/config');
        const { renderMultipleLines } = await import('../ccstatusline');
        const protectedPath = path.join(isolatedHome, 'settings.json');
        const original = fs.readFileSync(protectedPath, 'utf8');
        config.initConfigPath(protectedPath);
        await expect(renderMultipleLines({ codex: { schema: 1 } })).rejects.toThrow('separate');
        expect(fs.readFileSync(protectedPath, 'utf8')).toBe(original);
    });
}

const parentIt = isIsolatedChild ? it.skip : it;
parentIt('keeps the ordinary formatter version unchanged', () => {
    const executable = typeof Bun === 'undefined' ? (process.env.CODEXS_BASELINE_BUN ?? 'bun') : process.execPath;
    const result = spawnSync(executable, ['run', path.join(projectRoot, 'src', 'ccstatusline.ts'), '--version'], { input: '', encoding: 'utf8', windowsHide: true, timeout: 15000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('2.2.32\n');
    expect(result.stderr).toBe('');
});
parentIt.each(['--version', '-V'])('prints product identity before config validation or terminal checks: %s', (versionFlag) => {
    const executable = typeof Bun === 'undefined' ? (process.env.CODEXS_BASELINE_BUN ?? 'bun') : process.execPath;
    const result = spawnSync(executable, ['run', path.join(projectRoot, 'src', 'ccstatusline.ts'), '--codex', versionFlag, '--config'], { input: '{}', encoding: 'utf8', windowsHide: true, timeout: 15000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('codexs-statusline 1.0.0\n');
    expect(result.stderr).toBe('');
});
parentIt('requires a terminal for the Codex editor instead of rendering piped input', () => {
    const tempRoot = fs.realpathSync(os.tmpdir());
    const tempDir = fs.mkdtempSync(path.join(tempRoot, 'codexs-editor-entry-'));
    try {
        const configPath = path.join(tempDir, 'codex.json');
        fs.writeFileSync(configPath, JSON.stringify({ version: 4, lines: [[{ id: 'safe', type: 'custom-text', customText: 'SAFE' }]] }));
        const executable = typeof Bun === 'undefined' ? (process.env.CODEXS_BASELINE_BUN ?? 'bun') : process.execPath;
        const result = spawnSync(executable, ['run', path.join(projectRoot, 'src', 'ccstatusline.ts'), '--codex', '--config', configPath], { input: '{}', encoding: 'utf8', windowsHide: true, timeout: 15000 });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('interactive terminal');
        expect(result.stdout).toBe('');
    } finally {
        if (path.resolve(tempDir).startsWith(tempRoot + path.sep)) {
            fs.rmSync(tempDir, { recursive: true });
        }
    }
});
parentIt('runs Codex safety cases with all Claude paths isolated before formatter import', () => {
    const tempRoot = fs.realpathSync(os.tmpdir());
    const isolatedHome = fs.realpathSync(fs.mkdtempSync(path.join(tempRoot, 'codexs-task0a-')));
    if (!isolatedHome.startsWith(`${tempRoot}${path.sep}`)) {
        throw new Error('Isolated home escaped the temp root');
    }
    try {
        const settings = {
            version: 4,
            colorLevel: 0,
            lines: [[
                { id: 'safe-text', type: 'custom-text', customText: 'SAFE-CODEX' },
                { id: 'safe', type: 'session-usage' },
                { id: 'thinking', type: 'thinking-effort' },
                { id: 'window', type: 'context-window' },
                { id: 'block', type: 'block-timer' },
                ...codexUnavailableTypes.map((type, index) => ({ id: `claude-${index}`, type }))
            ]]
        };
        fs.writeFileSync(path.join(isolatedHome, 'config.json'), JSON.stringify(settings), 'utf8');
        fs.writeFileSync(path.join(isolatedHome, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'isolated@example.invalid' } }), 'utf8');
        fs.writeFileSync(path.join(isolatedHome, 'settings.json'), JSON.stringify({ effortLevel: 'claude-sentinel' }), 'utf8');
        fs.writeFileSync(path.join(isolatedHome, 'transcript.jsonl'), '', 'utf8');
        const bunExecutable = typeof Bun === 'undefined'
            ? (process.env.CODEXS_BASELINE_BUN ?? 'bun')
            : process.execPath;
        const result = spawnSync(bunExecutable, ['test', fileURLToPath(import.meta.url)], {
            cwd: projectRoot,
            env: {
                ...process.env,
                HOME: isolatedHome,
                USERPROFILE: isolatedHome,
                CLAUDE_CONFIG_DIR: isolatedHome,
                CLAUDE_SECURESTORAGE_CONFIG_DIR: isolatedHome,
                CODEXS_TASK0A_CHILD: '1',
                CODEXS_TASK0A_DIR: isolatedHome
            },
            windowsHide: true,
            timeout: 30_000,
            maxBuffer: 1024 * 1024
        });
        expect(result.error).toBeUndefined();
        if (result.status !== 0) {
            throw new Error(`Isolated safety probe exited ${result.status}: ${result.stderr.toString('utf8')}`);
        }
        expect(result.stderr.toString('utf8')).toContain(`${safetyCases.length + 6} pass`);
    } finally {
        const resolved = path.resolve(isolatedHome);
        if (resolved.startsWith(`${tempRoot}${path.sep}`)) {
            fs.rmSync(resolved, { recursive: true });
        }
    }
}, 30_000);

parentIt('can import the formatter without starting its stdin command', () => {
    const bunExecutable = typeof Bun === 'undefined'
        ? (process.env.CODEXS_BASELINE_BUN ?? 'bun')
        : process.execPath;
    const entry = path.join(projectRoot, 'src', 'ccstatusline.ts');
    const result = spawnSync(bunExecutable, ['-e', `import(${JSON.stringify(pathToFileURL(entry).href)})`], {
        cwd: projectRoot,
        input: '',
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 1024 * 1024
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('');
    expect(result.stderr.toString('utf8')).toBe('');
});

parentIt('can import the formatter when argv points to an unrelated missing file', () => {
    const bunExecutable = typeof Bun === 'undefined'
        ? (process.env.CODEXS_BASELINE_BUN ?? 'bun')
        : process.execPath;
    const entry = path.join(projectRoot, 'src', 'ccstatusline.ts');
    const missingArgv = path.join(projectRoot, '__codexs_task0a_missing_entry__');
    expect(fs.existsSync(missingArgv)).toBe(false);
    const result = spawnSync(bunExecutable, [
        '-e',
        `import(${JSON.stringify(pathToFileURL(entry).href)})`,
        missingArgv
    ], {
        cwd: projectRoot,
        input: '',
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 1024 * 1024
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('');
    expect(result.stderr.toString('utf8')).toBe('');
});

parentIt('keeps Claude formatter output byte-for-byte unchanged', () => {
    const fixturePayload = JSON.parse(fs.readFileSync(
        path.join(projectRoot, 'scripts', 'payload.example.json'),
        'utf8'
    )) as Record<string, unknown>;
    // The example's placeholder transcript does not exist. Its absence also keeps
    // token values sourced from the example payload instead of transcript analysis.
    delete fixturePayload.transcript_path;
    fixturePayload.effort = { level: 'high' };

    const settings = {
        version: 4,
        colorLevel: 0,
        lines: [[
            { id: 'm', type: 'model' },
            { id: 's1', type: 'separator' },
            { id: 'e', type: 'thinking-effort' },
            { id: 's2', type: 'separator' },
            { id: 'o', type: 'output-style' },
            { id: 's3', type: 'separator' },
            { id: 'c', type: 'context-percentage' },
            { id: 's4', type: 'separator' },
            { id: 't', type: 'tokens-input' },
            { id: 's5', type: 'separator' },
            { id: 'v', type: 'version' },
            { id: 's6', type: 'separator' },
            { id: 'x', type: 'custom-text', customText: '◆' }
        ], [], []]
    };

    const tempRoot = path.resolve(os.tmpdir());
    const tempDir = fs.mkdtempSync(path.join(tempRoot, 'codexs-claude-parity-'));
    try {
        const configPath = path.join(tempDir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(settings), 'utf8');

        const bunExecutable = typeof Bun === 'undefined'
            ? (process.env.CODEXS_BASELINE_BUN ?? 'bun')
            : process.execPath;
        const result = spawnSync(bunExecutable, [
            'run',
            path.join(projectRoot, 'src', 'ccstatusline.ts'),
            '--config',
            configPath
        ], {
            cwd: projectRoot,
            input: Buffer.from(JSON.stringify(fixturePayload), 'utf8'),
            env: {
                ...process.env,
                CCSTATUSLINE_WIDTH: '160',
                NO_COLOR: '1',
                FORCE_COLOR: '0',
                TZ: 'UTC',
                LANG: 'en_US.UTF-8',
                LC_ALL: 'en_US.UTF-8'
            },
            windowsHide: true,
            timeout: 15_000,
            maxBuffer: 1024 * 1024
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stderr.toString('utf8')).toBe('');
        expect(result.stdout).toEqual(expectedClaudeOutput);
    } finally {
        const resolved = path.resolve(tempDir);
        if (resolved.startsWith(`${tempRoot}${path.sep}`)) {
            fs.rmSync(resolved, { recursive: true });
        }
    }
});
