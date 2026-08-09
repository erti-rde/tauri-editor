import { describe, expect, it } from 'vitest';

import {
	MAX_RECENT,
	describeWhen,
	normaliseRecents,
	projectName,
	withProject
} from './recentProjects';

describe('naming a project', () => {
	it('uses the folder name, which is what people call it', () => {
		expect(projectName('/Users/ako/Documents/sea-level-paper')).toBe('sea-level-paper');
	});

	it('handles a Windows path', () => {
		// A project folder is meant to open on a co-author's machine too.
		expect(projectName('C:\\Users\\ako\\thesis')).toBe('thesis');
	});

	it('ignores a trailing separator', () => {
		expect(projectName('/Users/ako/thesis/')).toBe('thesis');
	});
});

describe('the recent list', () => {
	const at = (path: string, openedAt: string) => ({ path, name: projectName(path), openedAt });

	it('puts the newest first', () => {
		const list = withProject([at('/a', '2020-01-01')], '/b', '2020-01-02');

		expect(list.map((p) => p.path)).toEqual(['/b', '/a']);
	});

	it('moves a reopened project to the front rather than duplicating it', () => {
		const list = withProject([at('/a', '2020-01-01'), at('/b', '2020-01-02')], '/a', '2020-01-03');

		expect(list.map((p) => p.path)).toEqual(['/a', '/b']);
		expect(list).toHaveLength(2);
	});

	it('stays a shortlist rather than becoming a history', () => {
		let list = [] as ReturnType<typeof withProject>;
		for (let i = 0; i < MAX_RECENT + 5; i++) list = withProject(list, `/p${i}`);

		expect(list).toHaveLength(MAX_RECENT);
		expect(list[0].path).toBe(`/p${MAX_RECENT + 4}`);
	});
});

describe('reading what was stored', () => {
	it('survives a settings file that holds nonsense', () => {
		// It is on disk and can be hand-edited, and a broken launch screen would
		// keep someone out of their work entirely.
		expect(normaliseRecents(null)).toEqual([]);
		expect(normaliseRecents('nope')).toEqual([]);
		expect(normaliseRecents([{ nothing: true }, null, 42])).toEqual([]);
	});

	it('fills in a name that was not stored', () => {
		expect(normaliseRecents([{ path: '/Users/ako/thesis' }])[0].name).toBe('thesis');
	});

	it('lists a path once, however many times it was stored', () => {
		// Svelte keys the landing list by path, so a duplicate is not a cosmetic
		// repeat — it takes the launch screen down with a duplicate-key error.
		const list = normaliseRecents([
			{ path: '/a', openedAt: '2020-01-02' },
			{ path: '/a', openedAt: '2020-01-01' },
			{ path: '/b', openedAt: '2020-01-01' }
		]);

		expect(list.map((p) => p.path)).toEqual(['/a', '/b']);
		// The first wins, because the list is already newest-first.
		expect(list[0].openedAt).toBe('2020-01-02');
	});
});

describe('saying when', () => {
	const now = new Date('2026-06-15T12:00:00Z');
	const ago = (days: number) =>
		describeWhen(new Date(now.getTime() - days * 86_400_000).toISOString(), now);

	it('reads the way a person would say it', () => {
		expect(ago(0)).toBe('today');
		expect(ago(1)).toBe('yesterday');
		expect(ago(3)).toBe('3 days ago');
		expect(ago(60)).toBe('2 months ago');
		expect(ago(500)).toBe('over a year ago');
	});

	it('counts in singular where the count is one', () => {
		// This assertion previously read `'1 weeks ago'` — the test encoded the
		// bug as the expectation, which is why nothing caught it.
		expect(ago(10)).toBe('1 week ago');
		expect(ago(35)).toBe('1 month ago');
		expect(ago(20)).toBe('2 weeks ago');
	});

	it('says nothing rather than something wrong', () => {
		expect(describeWhen('')).toBe('');
		expect(describeWhen('not a date')).toBe('');
	});
});
