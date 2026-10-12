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

if (isIsolatedChild) {
    afterEach(() => {
        vi.restoreAllMocks();
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
        const statusRead = vi.spyOn(claudeStatus, 'prefetchClaudeStatusIfNeeded').mockResolvedValue(null);
        const skillsRead = vi.spyOn(skills, 'getSkillsMetrics').mockReturnValue({ totalInvocations: 0, uniqueSkills: [], lastSkill: null });
        const accountRead = vi.spyOn(claudeSettings, 'getClaudeJsonPath');
        const usageFetch = vi.spyOn(usage, 'fetchUsageData').mockResolvedValue({ sessionUsage: 99 });
        const credentialFileRead = vi.spyOn(fs, 'readFileSync');
        fs.readFileSync(path.join(isolatedHome, '.claude.json'), 'utf8');
        expect(credentialFileRead).toHaveBeenCalled();
        credentialFileRead.mockClear();
        const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const claudeRenderSpies = claudeOnlyTypes.map((type) => {
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
        expect(statusRead).not.toHaveBeenCalled();
        expect(skillsRead).not.toHaveBeenCalled();
        expect(accountRead).not.toHaveBeenCalled();
        expect(usageFetch).not.toHaveBeenCalled();
        expect(networkRequest).not.toHaveBeenCalled();
        expect(credentialFileRead.mock.calls.some(call => path.resolve(String(call[0])) === path.join(isolatedHome, '.claude.json'))).toBe(false);
        expect(JSON.stringify(settings.lines)).toBe(originalLines);
    });
}

const parentIt = isIsolatedChild ? it.skip : it;
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
                ...claudeOnlyTypes.map((type, index) => ({ id: `claude-${index}`, type }))
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
        expect(result.stderr.toString('utf8')).toContain('13 pass');
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
