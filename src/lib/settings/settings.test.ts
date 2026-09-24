import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The settings file, in memory: survives a "reload" of the module the way the
 * real file survives a restart, because it lives outside it.
 */
const file = vi.hoisted(() => new Map<string, unknown>());
const saves = vi.hoisted(() => ({ count: 0 }));

vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn(async () => ({
		get: async (key: string) => (file.has(key) ? structuredClone(file.get(key)) : undefined),
		set: async (key: string, value: unknown) => void file.set(key, structuredClone(value)),
		delete: async (key: string) => file.delete(key),
		save: async () => void saves.count++
	}))
}));

const settings = await import('./index');
const { SETTINGS, clearSetting, define, readFrom, readSetting, writeSetting } = settings;

beforeEach(() => {
	file.clear();
	saves.count = 0;
});

// M1a-11 AC-4
describe('an empty settings file', () => {
	it.each(Object.keys(SETTINGS) as (keyof typeof SETTINGS)[])(
		'reads %s as its default',
		async (name) => {
			expect(await readSetting(name)).toEqual(SETTINGS[name].default);
		}
	);

	it('means lookups were never asked about, not declined', async () => {
		expect(await readSetting('allowNetworkLookups')).toBeNull();
	});

	it('leaves the note nudges and the reference list on', async () => {
		expect(await readSetting('noteNudges')).toBe(true);
		expect(await readSetting('autoReferences')).toBe(true);
	});
});

// M1a-11 AC-2, AC-4
describe('writing', () => {
	it('stores the value and saves the file each time', async () => {
		await writeSetting('wordCount', 8000);
		await writeSetting('selectedLocale', 'en-GB');
		expect(file.get('wordCount')).toBe(8000);
		expect(saves.count).toBe(2);
	});

	it('persists across a reload of the app', async () => {
		await writeSetting('appearance', { theme: 'night-owl' });
		await writeSetting('recentProjects', [
			{ path: '/p/Thesis', name: 'Thesis', openedAt: '2026-09-25T09:00:00Z' }
		]);

		vi.resetModules();
		const reloaded = await import('./index');
		expect(await reloaded.readSetting('appearance')).toEqual({ theme: 'night-owl' });
		expect(await reloaded.readSetting('recentProjects')).toHaveLength(1);
	});

	it('type-checks the value against the setting', () => {
		// Compile-time only: `pnpm check` fails if either of these is accepted.
		const wrong = async () => {
			// @ts-expect-error a word count is a number
			await writeSetting('wordCount', '8000');
			// @ts-expect-error no such setting
			await writeSetting('wordcount', 8000);
		};
		expect(wrong).toBeTypeOf('function');
	});

	it('clears a setting back to its default', async () => {
		await writeSetting('noteNudges', false);
		await clearSetting('noteNudges');
		expect(await readSetting('noteNudges')).toBe(true);
	});
});

describe('a value of the wrong type', () => {
	it.each([
		['wordCount', 'lots'],
		['wordCount', Number.NaN],
		['noteNudges', 'no'],
		['recentProjects', { path: '/p' }],
		['appearance', ['night-owl']],
		['appearance', null],
		['cslXml', 42]
	] as const)('%s = %j reads as the default', async (name, stored) => {
		file.set(SETTINGS[name].key, stored);
		expect(await readSetting(name)).toEqual(SETTINGS[name].default);
	});

	it('is left in the file, for a newer build that may understand it', async () => {
		file.set('wordCount', 'lots');
		await readSetting('wordCount');
		expect(file.get('wordCount')).toBe('lots');
	});
});

// M1a-11 AC-2, AC-4
describe('a renamed key', () => {
	const citationTarget = define<number>({
		key: 'citationTarget',
		default: 0,
		where: 'global',
		accepts: (v) => typeof v === 'number',
		renamedFrom: ['wordTarget', 'target']
	});

	it('is read from its old name once, and moved', async () => {
		file.set('wordTarget', 6000);

		expect(await readFrom(citationTarget)).toBe(6000);
		expect(file.get('citationTarget')).toBe(6000);
		expect(file.has('wordTarget')).toBe(false);
		expect(saves.count).toBe(1);

		// Next time it's simply there.
		expect(await readFrom(citationTarget)).toBe(6000);
		expect(saves.count).toBe(1);
	});

	it('prefers the newest old name', async () => {
		file.set('target', 1000);
		file.set('wordTarget', 6000);
		expect(await readFrom(citationTarget)).toBe(6000);
		expect(file.get('target')).toBe(1000);
	});

	it('never overwrites a value already under the new name', async () => {
		file.set('citationTarget', 9000);
		file.set('wordTarget', 6000);
		expect(await readFrom(citationTarget)).toBe(9000);
		expect(file.get('wordTarget')).toBe(6000);
	});

	it('reads as the default when neither name is there', async () => {
		expect(await readFrom(citationTarget)).toBe(0);
		expect(saves.count).toBe(0);
	});
});

describe('the declarations', () => {
	it('give every setting a distinct key', () => {
		const keys = Object.values(SETTINGS).map((s) => s.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("accept each setting's own default", () => {
		for (const [name, setting] of Object.entries(SETTINGS)) {
			expect(setting.accepts(setting.default), name).toBe(true);
		}
	});
});
