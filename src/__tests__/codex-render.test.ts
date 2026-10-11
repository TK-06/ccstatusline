import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    expect,
    it
} from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Captured from the unmodified 2.2.32 formatter on 2026-10-11. SHA-256:
// 89A446F1DDF82FD0437FC386214C0F7193D163B9DC5173E89FF1219F715BAC5B
const expectedClaudeOutput = Buffer.from(
    'G1swbU1vZGVsOsKgT3B1c8KgNC42wqB8wqBUaGlua2luZzrCoGhpZ2jCoHzCoFN0eWxlOsKgZGVmYXVsdMKgfMKgQ3R4wqBVc2VkOsKgOC4wJcKgfMKgSW46wqA1MC4xa8KgfMKgdjIuMS44MMKgfMKg4peGCg==',
    'base64'
);

it('keeps Claude formatter output byte-for-byte unchanged', () => {
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
