import { describe, expect, it } from 'vitest';

import type { Loaded } from '$lib/manuscript/io';

import {
	citationsInProject,
	citationsOf,
	consequences,
	filePlace,
	REMOVED,
	removalTitle,
	separator
} from './removal';

const cite = (...ids: string[]) => ({ type: 'citation', attrs: { id: JSON.stringify(ids) } });
const doc = (...citations: object[]) => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: citations }]
});
const loaded = (content: object): Loaded => ({
	status: 'ok',
	content: content as Loaded['content'],
	sources: {},
	format: 1
});

// The work is `book`; `pdf` is a file attached to it.
const isBook = (id: string) => id === 'book' || id === 'pdf';

describe('counting citations (M1b-4 AC-1)', () => {
	it('counts each citation of the work once, by any of its ids', () => {
		expect(citationsOf(doc(cite('book'), cite('pdf', 'book'), cite('other')), isBook)).toBe(2);
	});

	it('counts across the project, naming the manuscripts that cite it', async () => {
		const files: Record<string, object> = {
			'/p/One.erti.json': doc(cite('book'), cite('book')),
			'/p/Two.erti.json': doc(cite('other')),
			'/p/Three.erti.json': doc(cite('pdf'))
		};
		const cited = await citationsInProject(
			[
				{ title: 'One', path: '/p/One.erti.json' },
				{ title: 'Two', path: '/p/Two.erti.json' },
				{ title: 'Three', path: '/p/Three.erti.json' }
			],
			async (path) => loaded(files[path]),
			isBook
		);
		expect(cited).toEqual({ count: 3, documents: ['One', 'Three'] });
	});

	it('carries on past a manuscript it cannot read', async () => {
		const cited = await citationsInProject(
			[
				{ title: 'Broken', path: '/p/Broken.erti.json' },
				{ title: 'One', path: '/p/One.erti.json' }
			],
			async (path) => {
				if (path.includes('Broken')) throw new Error('unreadable');
				return loaded(doc(cite('book')));
			},
			isBook
		);
		expect(cited).toEqual({ count: 1, documents: ['One'] });
	});
});

describe('what the dialog says (M1b-4 AC-1, UX-4)', () => {
	it('asks with the title', () => {
		expect(removalTitle('Attention Is All You Need')).toBe(
			'Remove “Attention Is All You Need” from your library?'
		);
	});

	it('says where it is cited, what will be deleted, and that the PDF stays', () => {
		const said = consequences({
			cited: { count: 4, documents: ['Chapter 1', 'Chapter 3'] },
			notes: 2,
			highlights: 11,
			file: 'elsewhere'
		});
		expect(said).toEqual({
			cited: {
				before: 'Cited 4 times in',
				documents: ['Chapter 1', 'Chapter 3'],
				after:
					'in this project. Those citations will show “not in your library” until you add it again.'
			},
			deleted: '2 notes and 11 highlights will be deleted.',
			file: 'The PDF itself stays where it is.'
		});
	});

	it('leaves out what does not apply, in the singular where it is one', () => {
		const said = consequences({
			cited: { count: 0, documents: [] },
			notes: 0,
			highlights: 1,
			file: 'none'
		});
		expect(said).toEqual({ cited: null, deleted: '1 highlight will be deleted.', file: null });
		expect(
			consequences({ cited: { count: 1, documents: ['A'] }, notes: 0, highlights: 0, file: 'none' })
		).toMatchObject({ cited: { before: 'Cited 1 time in' }, deleted: null });
	});

	it('says that a PDF in the project folder comes back with the next scan', () => {
		const said = consequences({
			cited: { count: 0, documents: [] },
			notes: 1,
			highlights: 0,
			file: 'in-project'
		});
		expect(said.file).toBe(
			'The PDF stays where it is. It’s in this project’s folder, so the next time the project opens, Erti will add it again as a new source.'
		);
	});

	it('tells a PDF in the project folder from one elsewhere', () => {
		expect(filePlace('/home/me/thesis/papers/a.pdf', '/home/me/thesis')).toBe('in-project');
		expect(filePlace('/home/me/thesis-old/a.pdf', '/home/me/thesis')).toBe('elsewhere');
		expect(filePlace('/home/me/Downloads/a.pdf', '/home/me/thesis/')).toBe('elsewhere');
		expect(filePlace(null, '/home/me/thesis')).toBe('none');
	});

	it('lists manuscripts as a sentence does', () => {
		const list = (names: string[]) => names.map((n, i) => n + separator(i, names.length)).join('');
		expect(list(['A'])).toBe('A');
		expect(list(['A', 'B'])).toBe('A and B');
		expect(list(['A', 'B', 'C'])).toBe('A, B and C');
	});
});

describe('afterwards (M1b-4 AC-4)', () => {
	it('points to the library backups in Settings', () => {
		expect(REMOVED).toBe(
			'Removed. You can restore it from a library backup in Settings › Library.'
		);
	});
});
