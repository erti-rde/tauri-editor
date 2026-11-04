import type { ZoteroCollection, ZoteroLibrary, ZoteroPaper, ZoteroPick } from '$lib/ipc';

/**
 * What's ticked in the Zotero tree (M1b-11 AC-4, docs/ux.md UX-13).
 *
 * Pure, so the rules are tested without a component. A node is ticked whole
 * or not at all; a node with something ticked under it but not itself is
 * "mixed". Ticking a node ticks everything known under it, and stands for
 * what isn't known yet too: a collection ticked before it's opened brings all
 * its papers. Unticking something under a ticked node splits that node into
 * its children, which is safe because a child is only on screen once its
 * parent's children are all known (the picker loads papers before it opens a
 * collection). When every child of a complete node is ticked, the node is.
 */

export type Kind = 'library' | 'collection' | 'unfiled' | 'item';

export interface TreeNode {
	id: string;
	kind: Kind;
	library: string;
	/** Zotero's key, for a collection or a paper. */
	key: string | null;
	name: string;
	parent: string | null;
	children: string[];
	/** Every child is known: a collection's papers have been loaded. */
	complete: boolean;
	/** Papers under it, for the row's count. */
	papers: number;
	/** For a paper's row. */
	paper?: ZoteroPaper;
}

export type Tree = ReadonlyMap<string, TreeNode>;
export type Ticked = ReadonlySet<string>;
export type State = 'checked' | 'mixed' | 'unchecked';

export const libraryId = (library: string) => `L|${library}`;
export const collectionId = (library: string, key: string) => `C|${library}|${key}`;
export const unfiledId = (library: string) => `U|${library}`;
export const paperId = (parent: string, key: string) => `I|${parent}|${key}`;

/** The tree as Zotero's libraries and collections draw it, papers not loaded yet. */
export function treeOf(libraries: ZoteroLibrary[]): Map<string, TreeNode> {
	const tree = new Map<string, TreeNode>();
	const addCollection = (library: string, c: ZoteroCollection, parent: string): string => {
		const id = collectionId(library, c.key);
		const node: TreeNode = {
			id,
			kind: 'collection',
			library,
			key: c.key,
			name: c.name,
			parent,
			children: [],
			// Nothing of its own to load.
			complete: c.papers === 0,
			papers: c.papers
		};
		tree.set(id, node);
		node.children = c.children.map((child) => addCollection(library, child, id));
		return id;
	};
	for (const library of libraries) {
		const id = libraryId(library.id);
		const node: TreeNode = {
			id,
			kind: 'library',
			library: library.id,
			key: null,
			name: library.name,
			parent: null,
			children: [],
			complete: true,
			papers: library.papers
		};
		tree.set(id, node);
		node.children = library.collections.map((c) => addCollection(library.id, c, id));
		if (library.unfiled > 0) {
			const unfiled = unfiledId(library.id);
			tree.set(unfiled, {
				id: unfiled,
				kind: 'unfiled',
				library: library.id,
				key: null,
				name: 'Unfiled',
				parent: id,
				children: [],
				complete: false,
				papers: library.unfiled
			});
			node.children.push(unfiled);
		}
	}
	return tree;
}

/**
 * A collection's or unfiled node's papers, now loaded, as its last children.
 * Under a ticked node they're ticked too.
 */
export function withPapers(
	tree: Tree,
	ticked: Ticked,
	parent: string,
	papers: ZoteroPaper[]
): { tree: Map<string, TreeNode>; ticked: Set<string> } {
	const next = new Map(tree);
	const nextTicked = new Set(ticked);
	const node = next.get(parent);
	if (!node || node.complete) return { tree: next, ticked: nextTicked };
	const ids = papers.map((paper) => {
		const id = paperId(parent, paper.key);
		next.set(id, {
			id,
			kind: 'item',
			library: node.library,
			key: paper.key,
			name: paper.title,
			parent,
			children: [],
			complete: true,
			papers: 1,
			paper
		});
		if (nextTicked.has(parent)) nextTicked.add(id);
		return id;
	});
	next.set(parent, { ...node, children: [...node.children, ...ids], complete: true });
	return { tree: next, ticked: nextTicked };
}

function below(tree: Tree, id: string): string[] {
	const out: string[] = [];
	const walk = (at: string) => {
		for (const child of tree.get(at)?.children ?? []) {
			out.push(child);
			walk(child);
		}
	};
	walk(id);
	return out;
}

function above(tree: Tree, id: string): string[] {
	const out: string[] = [];
	for (let at = tree.get(id)?.parent ?? null; at; at = tree.get(at)?.parent ?? null) {
		out.push(at);
	}
	return out;
}

export function stateOf(tree: Tree, ticked: Ticked, id: string): State {
	if (ticked.has(id)) return 'checked';
	return below(tree, id).some((child) => ticked.has(child)) ? 'mixed' : 'unchecked';
}

/** Tick a node and all under it, or untick it if it's ticked (AC-4). */
export function toggle(tree: Tree, ticked: Ticked, id: string): Set<string> {
	const next = new Set(ticked);
	if (!tree.has(id)) return next;
	const parents = above(tree, id);

	if (next.has(id)) {
		// Each ticked node above splits into its children, which are ticked
		// already; then this one, and all under it, goes.
		for (const parent of parents) next.delete(parent);
		next.delete(id);
		for (const child of below(tree, id)) next.delete(child);
	} else {
		next.add(id);
		for (const child of below(tree, id)) next.add(child);
		// A complete node whose children are all ticked is ticked itself.
		for (const parent of parents) {
			const node = tree.get(parent);
			if (!node?.complete || node.children.length === 0) break;
			if (!node.children.every((child) => next.has(child))) break;
			next.add(parent);
		}
	}
	return next;
}

/** What to read and follow: each ticked node with nothing ticked above it. */
export function picksOf(tree: Tree, ticked: Ticked): ZoteroPick[] {
	const picks: ZoteroPick[] = [];
	for (const id of ticked) {
		const node = tree.get(id);
		if (!node || above(tree, id).some((parent) => ticked.has(parent))) continue;
		picks.push({
			library: node.library,
			kind: node.kind,
			key: node.key,
			name: node.kind === 'unfiled' ? `Unfiled (${libraryName(tree, node)})` : node.name
		});
	}
	return picks;
}

function libraryName(tree: Tree, node: TreeNode): string {
	return tree.get(libraryId(node.library))?.name ?? node.library;
}
