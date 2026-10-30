import {
    describe,
    expect,
    it
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { getWidgetCatalog } from '../../utils/widgets';
import {
    CODEXS_STATUSLINE_NAME,
    CODEXS_VERSION,
    CODEX_WIDGET_SUPPORT,
    getCodexPreviewLines,
    getCodexWidgetCatalog,
    getCodexWidgetSupport,
    validateCodexEditorArgs
} from '../codex-profile';

describe('Codex editor profile', () => {
    it('defines the prototype product identity separately from the upstream formatter', () => {
        expect(CODEXS_STATUSLINE_NAME).toBe('codexs-statusline');
        expect(CODEXS_VERSION).toBe('1.0.0');
    });

    it('explicitly classifies every registered widget and layout type', async () => {
        const { LAYOUT_WIDGET_MANIFEST, WIDGET_MANIFEST } = await import('../../utils/widget-manifest');
        const types = [...WIDGET_MANIFEST, ...LAYOUT_WIDGET_MANIFEST].map(entry => entry.type).sort();
        expect(Object.keys(CODEX_WIDGET_SUPPORT).sort()).toEqual(types);
    });

    it('classifies the verified native mappings and unavailable Claude data', () => {
        const inventory = Object.values(CODEX_WIDGET_SUPPORT);
        expect(inventory).toHaveLength(92);
        expect(inventory.filter(entry => entry.state === 'available')).toHaveLength(69);
        expect(inventory.filter(entry => entry.state === 'pending')).toHaveLength(0);
        expect(inventory.filter(entry => entry.state === 'unavailable')).toHaveLength(23);
        expect(getCodexWidgetSupport('model').state).toBe('available');
        expect(getCodexWidgetSupport('context-bar').state).toBe('available');
        for (const type of ['tokens-cached', 'tokens-total', 'cache-hit-rate', 'cache-read', 'input-speed', 'output-speed', 'total-speed', 'session-name', 'compaction-counter']) {
            expect(getCodexWidgetSupport(type).state).toBe('available');
            expect(getCodexWidgetSupport(type).reason).toContain('valid native');
        }
        expect(getCodexWidgetSupport('claude-account-email').state).toBe('unavailable');
        expect(getCodexWidgetSupport('cache-write').state).toBe('unavailable');
        expect(getCodexWidgetSupport('context-percentage-usable').state).toBe('unavailable');
        expect(getCodexWidgetSupport('future-widget').state).toBe('unavailable');
    });

    it('keeps the existing catalog and customization keys while explaining unavailable entries', () => {
        const catalog = getCodexWidgetCatalog(DEFAULT_SETTINGS);
        expect(catalog.map(entry => entry.type)).toEqual(getWidgetCatalog(DEFAULT_SETTINGS).map(entry => entry.type));
        expect(catalog.find(entry => entry.type === 'total-speed')?.description).toContain('window');
        expect(catalog.find(entry => entry.type === 'compaction-counter')?.description).toContain('suboptions');
        expect(catalog.find(entry => entry.type === 'claude-session-id')?.displayName).toBe('Codex Session ID');
        expect(catalog.find(entry => entry.type === 'claude-account-email')?.description).toContain('Unavailable');
    });

    it('filters previews without rewriting imported lines or unsupported settings', () => {
        const lines = [[
            { id: 'one', type: 'model', color: 'cyan', metadata: { keep: 'yes' } },
            { id: 'two', type: 'claude-status' },
            { id: 'three', type: 'total-speed' },
            { id: 'four', type: 'future-widget' }
        ], [{ id: 'five', type: 'custom-text', customText: 'extra line' }]];
        const before = structuredClone(lines);
        expect(getCodexPreviewLines(lines).map(line => line.map(item => item.id))).toEqual([['one', 'three'], ['five']]);
        expect(lines).toEqual(before);
    });

    it('hides unsupported options without changing imported metadata', () => {
        const lines: WidgetItem[][] = [[
            ...['input-speed', 'output-speed', 'total-speed'].flatMap(type => [
                { id: `${type}-window`, type, metadata: { windowSeconds: '30', future: 'retained' } },
                { id: `${type}-cumulative`, type, metadata: { windowSeconds: '0', future: 'retained' } }
            ]),
            ...['reclaimed', 'average', 'unknown'].map(metric => ({ id: metric, type: 'compaction-counter', metadata: { metric } })),
            { id: 'triggers', type: 'compaction-counter', metadata: { showTriggers: 'true' } },
            { id: 'reclaimed-suffix', type: 'compaction-counter', metadata: { showReclaimed: 'true' } },
            { id: 'count', type: 'compaction-counter', metadata: { metric: 'count', future: 'retained' } },
            { id: 'default', type: 'compaction-counter', metadata: { future: 'retained' } }
        ]];
        const original = structuredClone(lines);
        const preview = getCodexPreviewLines(lines);
        expect(preview[0]?.map(item => item.id)).toEqual(['input-speed-cumulative', 'output-speed-cumulative', 'total-speed-cumulative', 'count', 'default']);
        expect(lines).toEqual(original);
        for (const item of preview[0] ?? []) {
            expect(item).toBe(lines[0]?.find(source => source.id === item.id));
            expect(item.metadata?.future).toBe('retained');
        }
    });

    it('requires an explicit config before Codex editor mode can start', () => {
        expect(() => validateCodexEditorArgs(['--codex'])).toThrow('explicit --config');
        expect(() => validateCodexEditorArgs(['--codex', '--config'])).toThrow('explicit --config');
        expect(() => validateCodexEditorArgs(['--codex', '--config', '--version'])).toThrow('explicit --config');
        expect(validateCodexEditorArgs(['--codex', '--config', 'synthetic settings.json'])).toBe(true);
        expect(validateCodexEditorArgs([])).toBe(false);
    });
});
