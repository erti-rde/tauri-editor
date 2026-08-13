import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import { workspaceStore } from './workspaceStore';
import { activeTab, paneById, type Tab } from './tabs';

const doc = (name: string): Tab => ({ id: `/p/${name}.erti.json`, kind: 'document', title: name });
const pdf = (name: string): Tab => ({ id: `/p/${name}.pdf`, kind: 'pdf', title: name });

beforeEach(() => workspaceStore.reset());

describe('a manuscript is edited in one place', () => {
	it('moves rather than copies when opened in the other pane', () => {
		// Two editors on one document would both autosave it, and the slower write
		// would overwrite the newer one. That is silent data loss, so the model
		// forbids the situation rather than trying to reconcile it.
		workspaceStore.open(pdf('smith-2020'));
		workspaceStore.split();
		const panes = get(workspaceStore).panes.map((p) => p.id);

		workspaceStore.open(doc('chapter-1'), panes[0]);
		workspaceStore.open(doc('chapter-1'), panes[1]);

		const ws = get(workspaceStore);
		expect(paneById(ws, panes[0])!.tabs).not.toContain(doc('chapter-1').id);
		expect(paneById(ws, panes[1])!.tabs).toContain(doc('chapter-1').id);
	});

	it('opens an empty pane beside the manuscript rather than cloning it', () => {
		// Splitting on a manuscript is a request for somewhere to put the paper
		// you are writing about. Cloning it and closing the original would empty
		// the first pane and collapse straight back to one.
		workspaceStore.open(doc('chapter-1'));

		workspaceStore.split();

		const ws = get(workspaceStore);
		expect(ws.panes).toHaveLength(2);

		const holding = ws.panes.filter((p) => p.tabs.includes(doc('chapter-1').id));
		expect(holding).toHaveLength(1);
		// The writing stays where it was; the new, empty pane takes focus.
		expect(holding[0].id).not.toBe(ws.focused);
		expect(paneById(ws, ws.focused)!.tabs).toHaveLength(0);
	});

	it('opens the next file into the pane the split just made', () => {
		workspaceStore.open(doc('chapter-1'));
		workspaceStore.split();

		workspaceStore.open(pdf('smith-2020'));

		const ws = get(workspaceStore);
		expect(activeTab(ws, ws.focused)?.title).toBe('smith-2020');
		expect(ws.panes).toHaveLength(2);
	});
});

describe('papers can be anywhere', () => {
	it('opens the same PDF on both sides', () => {
		// Reading one paper's methods against its results is a real thing to want,
		// and nothing about a PDF makes two views of it dangerous.
		workspaceStore.open(pdf('smith-2020'));
		workspaceStore.split();

		const ws = get(workspaceStore);
		expect(ws.panes).toHaveLength(2);
		expect(activeTab(ws, ws.panes[0].id)?.title).toBe('smith-2020');
		expect(activeTab(ws, ws.panes[1].id)?.title).toBe('smith-2020');
	});

	it('keeps a paper open on one side when closed on the other', () => {
		workspaceStore.open(pdf('smith-2020'));
		workspaceStore.split();
		const [left, right] = get(workspaceStore).panes.map((p) => p.id);
		workspaceStore.open(pdf('jones-2019'), right);

		workspaceStore.close(left, pdf('smith-2020').id);

		const ws = get(workspaceStore);
		expect(paneById(ws, right)!.tabs).toContain(pdf('smith-2020').id);
	});
});

describe('starting over', () => {
	it('clears everything when a different project opens', () => {
		workspaceStore.open(doc('chapter-1'));
		workspaceStore.open(pdf('smith-2020'));
		workspaceStore.split();

		workspaceStore.reset();

		const ws = get(workspaceStore);
		expect(ws.panes).toHaveLength(1);
		expect(ws.panes[0].tabs).toHaveLength(0);
		expect(Object.keys(ws.tabs)).toHaveLength(0);
	});

	it('does not reuse a pane id from the last project', () => {
		// A stale id colliding with a fresh pane would put one project's tabs in
		// another's pane.
		workspaceStore.open(doc('a'));
		workspaceStore.split();
		const before = get(workspaceStore).panes.map((p) => p.id);

		workspaceStore.reset();
		workspaceStore.open(doc('b'));
		workspaceStore.split();

		expect(get(workspaceStore).panes.map((p) => p.id)).toEqual(before);
	});
});
