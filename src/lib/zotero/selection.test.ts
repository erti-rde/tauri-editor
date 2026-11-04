import { describe, expect, it } from 'vitest';

import type { ZoteroLibrary, ZoteroPaper } from '$lib/ipc';
import {
	collectionId,
	libraryId,
	paperId,
	picksOf,
	stateOf,
	toggle,
	treeOf,
	unfiledId,
	withPapers,
	type Ticked,
	type Tree
} from './selection';

const libraries: ZoteroLibrary[] = [
	{
		id: 'user',
		name: 'My Library',
		papers: 6,
		unfiled: 1,
		collections: [
			{ key: 'METHODS2', name: 'Methods', papers: 2, children: [] },
			{
				key: 'THESIS22',
				name: 'Thesis',
				papers: 1,
				children: [{ key: 'CHAPTER2', name: 'Chapter 2', papers: 2, children: [] }]
			}
		]
	},
	{ id: 'group:4242', name: 'Lab reading', papers: 0, unfiled: 0, collections: [] }
];

const paper = (key: string, title = key): ZoteroPaper => ({
	key,
	title,
	creators: '',
	year: null,
	pdfs: 1
});

const methods = collectionId('user', 'METHODS2');
const thesis = collectionId('user', 'THESIS22');
const chapter = collectionId('user', 'CHAPTER2');
const mine = libraryId('user');

/** The tree with Thesis opened: its own paper loaded. */
function opened(): { tree: Tree; ticked: Ticked } {
	return withPapers(treeOf(libraries), new Set(), thesis, [paper('PAPERCC3')]);
}

// M1b-11 AC-3
describe('treeOf', () => {
	it('draws libraries, collections nested, and unfiled where there are any', () => {
		const tree = treeOf(libraries);
		expect(tree.get(mine)?.children).toEqual([methods, thesis, unfiledId('user')]);
		expect(tree.get(thesis)?.children).toEqual([chapter]);
		expect(tree.get(libraryId('group:4242'))?.children).toEqual([]);
		expect(tree.has(unfiledId('group:4242'))).toBe(false);
	});
});

// M1b-11 AC-4
describe('toggle', () => {
	it('ticks a collection and everything under it, and the pick is the collection', () => {
		const { tree, ticked } = opened();
		const next = toggle(tree, ticked, thesis);
		expect(stateOf(tree, next, thesis)).toBe('checked');
		expect(stateOf(tree, next, chapter)).toBe('checked');
		expect(stateOf(tree, next, mine)).toBe('mixed');
		expect(picksOf(tree, next)).toEqual([
			{ library: 'user', kind: 'collection', key: 'THESIS22', name: 'Thesis' }
		]);
	});

	it('splits a ticked collection into what is left when one thing under it is unticked', () => {
		const { tree, ticked } = opened();
		const all = toggle(tree, ticked, thesis);
		const next = toggle(tree, all, chapter);
		expect(stateOf(tree, next, thesis)).toBe('mixed');
		expect(stateOf(tree, next, chapter)).toBe('unchecked');
		expect(picksOf(tree, next)).toEqual([
			{ library: 'user', kind: 'item', key: 'PAPERCC3', name: 'PAPERCC3' }
		]);
	});

	it('ticks a complete parent once every child is ticked', () => {
		const { tree, ticked } = opened();
		let next = toggle(tree, ticked, chapter);
		expect(stateOf(tree, next, thesis)).toBe('mixed');
		next = toggle(tree, next, paperId(thesis, 'PAPERCC3'));
		expect(stateOf(tree, next, thesis)).toBe('checked');
		expect(picksOf(tree, next).map((p) => p.kind)).toEqual(['collection']);
	});

	it('never ticks a parent whose own papers are not loaded yet', () => {
		const tree = treeOf(libraries);
		// Thesis has a paper of its own, not loaded: Chapter 2 isn't all of it.
		const next = toggle(tree, new Set(), chapter);
		expect(stateOf(tree, next, thesis)).toBe('mixed');
	});

	it('unticks a mixed node by ticking it whole first, as a checkbox does', () => {
		const { tree, ticked } = opened();
		const some = toggle(tree, ticked, chapter);
		const whole = toggle(tree, some, thesis);
		expect(stateOf(tree, whole, thesis)).toBe('checked');
		expect(stateOf(tree, toggle(tree, whole, thesis), thesis)).toBe('unchecked');
	});

	it('ticks a whole library as one pick', () => {
		const tree = treeOf(libraries);
		const next = toggle(tree, new Set(), mine);
		expect(picksOf(tree, next)).toEqual([
			{ library: 'user', kind: 'library', key: null, name: 'My Library' }
		]);
		const unfiled = picksOf(tree, toggle(tree, new Set(), unfiledId('user')));
		expect(unfiled).toEqual([
			{ library: 'user', kind: 'unfiled', key: null, name: 'Unfiled (My Library)' }
		]);
	});
});

describe('withPapers', () => {
	it('ticks papers that load under a ticked collection', () => {
		const tree = treeOf(libraries);
		const ticked = toggle(tree, new Set(), methods);
		const loaded = withPapers(tree, ticked, methods, [paper('PAPERAA2'), paper('PAPEREE5')]);
		expect(stateOf(loaded.tree, loaded.ticked, paperId(methods, 'PAPERAA2'))).toBe('checked');
		expect(loaded.tree.get(methods)?.complete).toBe(true);
	});

	it('loads a branch once', () => {
		const { tree, ticked } = opened();
		const again = withPapers(tree, ticked, thesis, [paper('OTHERXX2')]);
		expect(again.tree.get(thesis)?.children).toEqual(tree.get(thesis)?.children);
	});
});
