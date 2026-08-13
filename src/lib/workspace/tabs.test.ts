import { describe, expect, it } from 'vitest';

import {
	MAX_PANES,
	activeTab,
	closeTab,
	emptyWorkspace,
	focusPane,
	focusedPane,
	moveTab,
	openTab,
	paneById,
	splitPane,
	type Tab,
	type Workspace
} from './tabs';

const doc = (name: string): Tab => ({ id: `/p/${name}.erti.json`, kind: 'document', title: name });
const pdf = (name: string): Tab => ({ id: `/p/${name}.pdf`, kind: 'pdf', title: name });

/** Open several files into the focused pane, left to right. */
const openAll = (workspace: Workspace, ...tabs: Tab[]) =>
	tabs.reduce((ws, tab) => openTab(ws, tab), workspace);

describe('opening files', () => {
	it('shows the file it just opened', () => {
		const ws = openTab(emptyWorkspace(), doc('chapter-1'));

		expect(activeTab(ws, ws.focused)?.title).toBe('chapter-1');
		expect(focusedPane(ws).tabs).toHaveLength(1);
	});

	it('keeps earlier files open behind it', () => {
		const ws = openAll(emptyWorkspace(), doc('one'), pdf('smith-2020'));

		expect(focusedPane(ws).tabs).toHaveLength(2);
		expect(activeTab(ws, ws.focused)?.kind).toBe('pdf');
	});

	it('brings a file already open forward rather than opening it twice', () => {
		const ws = openAll(emptyWorkspace(), doc('one'), pdf('smith-2020'));
		const again = openTab(ws, doc('one'));

		expect(focusedPane(again).tabs).toHaveLength(2);
		expect(activeTab(again, again.focused)?.title).toBe('one');
	});

	it('takes a renamed title rather than keeping the stale one', () => {
		const ws = openTab(emptyWorkspace(), doc('draft'));
		const renamed = openTab(ws, { ...doc('draft'), title: 'chapter-1' });

		expect(activeTab(renamed, renamed.focused)?.title).toBe('chapter-1');
	});

	it('opens into the pane that was asked for, and focuses it', () => {
		const split = splitPane(openTab(emptyWorkspace(), doc('one')), 'pane-2');
		const ws = openTab(split, pdf('smith-2020'), 'pane-1');

		expect(ws.focused).toBe('pane-1');
		expect(paneById(ws, 'pane-1')!.tabs).toHaveLength(2);
		expect(paneById(ws, 'pane-2')!.tabs).toHaveLength(1);
	});
});

describe('closing a tab', () => {
	it('falls to the tab on the right', () => {
		// What every editor does, and what the hand expects when closing a run of
		// tabs left to right.
		let ws = openAll(emptyWorkspace(), doc('a'), doc('b'), doc('c'));
		ws = openTab(ws, doc('b'));

		ws = closeTab(ws, ws.focused, doc('b').id);

		expect(activeTab(ws, ws.focused)?.title).toBe('c');
	});

	it('falls to the left when there is nothing to the right', () => {
		let ws = openAll(emptyWorkspace(), doc('a'), doc('b'));

		ws = closeTab(ws, ws.focused, doc('b').id);

		expect(activeTab(ws, ws.focused)?.title).toBe('a');
	});

	it('leaves the shown tab alone when a different one closes', () => {
		let ws = openAll(emptyWorkspace(), doc('a'), doc('b'), doc('c'));

		ws = closeTab(ws, ws.focused, doc('a').id);

		expect(activeTab(ws, ws.focused)?.title).toBe('c');
	});

	it('empties the last pane rather than removing it', () => {
		// A window with no panes has nowhere to open the next file.
		let ws = openTab(emptyWorkspace(), doc('a'));

		ws = closeTab(ws, ws.focused, doc('a').id);

		expect(ws.panes).toHaveLength(1);
		expect(activeTab(ws, ws.focused)).toBeNull();
	});

	it('ignores a tab the pane does not have', () => {
		const ws = openTab(emptyWorkspace(), doc('a'));

		expect(closeTab(ws, ws.focused, '/p/nowhere.pdf')).toBe(ws);
	});
});

describe('two panes', () => {
	it('keeps the file open on both sides when split', () => {
		// The point of splitting: read the paper beside the chapter about it.
		const ws = splitPane(openTab(emptyWorkspace(), pdf('smith-2020')), 'pane-2');

		expect(ws.panes).toHaveLength(2);
		expect(activeTab(ws, 'pane-1')?.title).toBe('smith-2020');
		expect(activeTab(ws, 'pane-2')?.title).toBe('smith-2020');
		expect(ws.focused).toBe('pane-2');
	});

	it('refuses a third pane', () => {
		const two = splitPane(openTab(emptyWorkspace(), doc('a')), 'pane-2');

		expect(splitPane(two, 'pane-3').panes).toHaveLength(MAX_PANES);
	});

	it('will not split an empty pane', () => {
		const ws = emptyWorkspace();

		expect(splitPane(ws, 'pane-2')).toBe(ws);
	});

	it('removes a pane that loses its last tab, and moves focus', () => {
		let ws = splitPane(openTab(emptyWorkspace(), doc('a')), 'pane-2');

		ws = closeTab(ws, 'pane-2', doc('a').id);

		expect(ws.panes).toHaveLength(1);
		expect(ws.focused).toBe('pane-1');
	});

	it('keeps a file open on the right when it is closed on the left', () => {
		// `tabs` is shared, so a careless cleanup would blank both sides at once.
		// Closing on the left must not disturb what the right is showing either.
		let ws = splitPane(openTab(emptyWorkspace(), pdf('smith-2020')), 'pane-2');
		ws = openTab(ws, doc('chapter-1'), 'pane-2');

		ws = closeTab(ws, 'pane-1', pdf('smith-2020').id);

		expect(paneById(ws, 'pane-2')!.tabs).toContain(pdf('smith-2020').id);
		expect(ws.tabs[pdf('smith-2020').id]).toBeDefined();
		expect(activeTab(ws, 'pane-2')?.title).toBe('chapter-1');
	});

	it('forgets a file once no pane shows it', () => {
		let ws = splitPane(openTab(emptyWorkspace(), pdf('smith-2020')), 'pane-2');
		ws = openTab(ws, doc('chapter-1'), 'pane-2');
		ws = closeTab(ws, 'pane-1', pdf('smith-2020').id);

		ws = closeTab(ws, 'pane-2', pdf('smith-2020').id);

		expect(ws.tabs[pdf('smith-2020').id]).toBeUndefined();
	});
});

describe('moving a tab between panes', () => {
	it('takes it out of the pane it came from', () => {
		let ws = openAll(emptyWorkspace(), doc('a'), doc('b'));
		ws = splitPane(ws, 'pane-2');

		ws = moveTab(ws, doc('a').id, 'pane-1', 'pane-2');

		expect(paneById(ws, 'pane-1')!.tabs).not.toContain(doc('a').id);
		expect(paneById(ws, 'pane-2')!.tabs).toContain(doc('a').id);
	});

	it('does nothing when the destination is where it already is', () => {
		const ws = openTab(emptyWorkspace(), doc('a'));

		expect(moveTab(ws, doc('a').id, 'pane-1', 'pane-1')).toBe(ws);
	});

	it('closes the pane it emptied', () => {
		let ws = openTab(emptyWorkspace(), doc('a'));
		ws = splitPane(ws, 'pane-2');
		ws = openTab(ws, doc('b'), 'pane-2');
		ws = closeTab(ws, 'pane-2', doc('a').id);

		ws = moveTab(ws, doc('b').id, 'pane-2', 'pane-1');

		expect(ws.panes).toHaveLength(1);
		expect(paneById(ws, 'pane-1')!.tabs).toHaveLength(2);
	});
});

describe('focus', () => {
	it('follows the pane that was asked for', () => {
		const ws = splitPane(openTab(emptyWorkspace(), doc('a')), 'pane-2');

		expect(focusPane(ws, 'pane-1').focused).toBe('pane-1');
	});

	it('ignores a pane that is not there', () => {
		const ws = openTab(emptyWorkspace(), doc('a'));

		expect(focusPane(ws, 'pane-9')).toBe(ws);
	});

	it('still yields a pane when the focused id has gone stale', () => {
		// Every caller would otherwise have to handle an impossible null.
		const ws: Workspace = { ...openTab(emptyWorkspace(), doc('a')), focused: 'pane-gone' };

		expect(focusedPane(ws).id).toBe('pane-1');
	});
});
