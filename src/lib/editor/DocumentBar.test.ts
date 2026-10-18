import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { focusSettles } from '$lib/harness/testing';
import UiHarness from '$lib/ui/UiHarness.svelte';
import DocumentBar from './DocumentBar.svelte';

/** As the app mounts it: inside the tooltip provider its tab controls need. */
const renderBar = (props: Record<string, unknown>) =>
	render(UiHarness, { props: { component: DocumentBar, ...props } });

afterEach(() => cleanup());

/**
 * Open the naming field and type a name. The field is returned so a test can
 * blur it after it has left the page: browsers blur a focused element as it
 * is removed, which jsdom doesn't, so the tests send that blur themselves.
 */
async function nameNewDocument(name: string) {
	const oncreate = vi.fn();
	const view = renderBar({
		documents: [],
		current: null,
		onopen: vi.fn(),
		oncreate,
		onhistory: vi.fn()
	});
	await fireEvent.click(view.getByRole('button', { name: '+ New' }));
	const field = view.getByRole('textbox', { name: 'Name for the new document' });
	await fireEvent.input(field, { target: { value: name } });
	return { view, field, oncreate };
}

describe('DocumentBar', () => {
	it('Enter creates the document once, though the field blurs as it goes', async () => {
		const { view, field, oncreate } = await nameNewDocument('Chapter two');

		await fireEvent.keyDown(field, { key: 'Enter' });
		await tick();
		await fireEvent.blur(field);

		expect(oncreate).toHaveBeenCalledTimes(1);
		expect(oncreate).toHaveBeenCalledWith('Chapter two');
		expect(view.queryByRole('textbox')).toBeNull();
	});

	it('Escape creates nothing, though the field blurs as it goes', async () => {
		const { view, field, oncreate } = await nameNewDocument('Chapter two');

		await fireEvent.keyDown(field, { key: 'Escape' });
		await tick();
		await fireEvent.blur(field);

		expect(oncreate).not.toHaveBeenCalled();
		expect(view.getByRole('button', { name: '+ New' })).toBeTruthy();
	});

	it('leaving the field creates the document it names', async () => {
		const { field, oncreate } = await nameNewDocument('  Chapter two  ');

		await fireEvent.blur(field);

		expect(oncreate).toHaveBeenCalledTimes(1);
		expect(oncreate).toHaveBeenCalledWith('Chapter two');
	});

	it('a blank name creates nothing', async () => {
		const { field, oncreate } = await nameNewDocument('   ');

		await fireEvent.keyDown(field, { key: 'Enter' });

		expect(oncreate).not.toHaveBeenCalled();
	});
});

describe('the document menu', () => {
	const chapter = {
		fileName: 'Chapter 1.erti.json',
		path: '/p/Chapter 1.erti.json',
		title: 'Chapter 1',
		legacy: false
	};

	// M5-1 AC-4: History… is on the open document's menu (UX-9).
	it('opens the open document’s history', async () => {
		const user = userEvent.setup();
		const onhistory = vi.fn();
		const view = renderBar({
			documents: [chapter],
			current: chapter,
			onopen: vi.fn(),
			oncreate: vi.fn(),
			onhistory
		});

		view.getByRole('button', { name: 'Chapter 1 menu' }).focus();
		await user.keyboard('{Enter}');
		// jsdom never positions the menu, so it counts as hidden (primitives.test.ts).
		const [history] = await screen.findAllByRole('menuitem', { hidden: true });
		// Only History… without the editor's handlers for the rest.
		expect(history.textContent?.trim()).toBe('History…');
		await waitFor(() => expect(document.activeElement).toBe(history), { timeout: 5000 });
		await user.keyboard('{Enter}');

		expect(onhistory).toHaveBeenCalledTimes(1);
	});

	it('isn’t there without an open document', () => {
		const view = renderBar({
			documents: [],
			current: null,
			onopen: vi.fn(),
			oncreate: vi.fn(),
			onhistory: vi.fn()
		});
		expect(view.queryByRole('button', { name: /menu$/ })).toBeNull();
	});
});

describe('M5-7 the document menu', () => {
	const chapter = {
		fileName: 'Chapter 1.erti.json',
		path: '/p/Chapter 1.erti.json',
		title: 'Chapter 1',
		legacy: false
	};
	const methods = {
		fileName: 'Methods.erti.json',
		path: '/p/Methods.erti.json',
		title: 'Methods',
		legacy: false
	};

	function mount() {
		const handlers = {
			onopen: vi.fn(),
			oncreate: vi.fn(),
			onhistory: vi.fn(),
			onrename: vi.fn(),
			onduplicate: vi.fn(),
			ondelete: vi.fn(async () => {})
		};
		const view = renderBar({ documents: [chapter, methods], current: chapter, ...handlers });
		return { view, ...handlers };
	}

	async function choose(label: string) {
		const user = userEvent.setup();
		screen.getByRole('button', { name: 'Chapter 1 menu' }).focus();
		await user.keyboard('{Enter}');
		const items = await screen.findAllByRole('menuitem', { hidden: true });
		const item = items.find((i) => i.textContent?.trim() === label)!;
		// Until bits-ui has stopped moving focus: a frame after the first item
		// has it, its focus scope can take it back, and Enter then chooses that.
		await focusSettles((focused) => expect(focused).toBe(items[0]));
		item.focus();
		await user.keyboard('{Enter}');
		return user;
	}

	// M5-7 AC-1
	it('offers Rename…, Duplicate, History… and, after a line, Delete…', async () => {
		const user = userEvent.setup();
		mount();

		screen.getByRole('button', { name: 'Chapter 1 menu' }).focus();
		await user.keyboard('{Enter}');

		const items = await screen.findAllByRole('menuitem', { hidden: true });
		expect(items.map((i) => i.textContent?.trim())).toEqual([
			'Rename…',
			'Duplicate',
			'History…',
			'Delete…'
		]);
		// Only the open document has one.
		expect(screen.queryByRole('button', { name: 'Methods menu' })).toBeNull();
	});

	it('renames in the tab, and won’t take another document’s name', async () => {
		const { onrename } = mount();
		const user = await choose('Rename…');

		const field = await screen.findByRole('textbox', { name: 'Name for Chapter 1' });
		await waitFor(() => expect(field).toHaveFocus());
		await user.keyboard('methods{Enter}');
		expect(field).toHaveAccessibleDescription('A document called "methods" is already here.');
		expect(onrename).not.toHaveBeenCalled();

		await user.clear(field);
		await user.keyboard('Introduction{Enter}');
		expect(onrename).toHaveBeenCalledWith('Introduction');
		expect(screen.queryByRole('textbox')).toBeNull();
	});

	it('duplicates', async () => {
		const { onduplicate } = mount();
		await choose('Duplicate');
		expect(onduplicate).toHaveBeenCalledTimes(1);
	});

	it('asks before deleting, and says the history stays', async () => {
		const { ondelete } = mount();
		const user = await choose('Delete…');

		const dialog = await screen.findByRole('dialog', { name: 'Delete “Chapter 1”?' });
		expect(dialog).toHaveTextContent('It moves to the bin, and can be put back from there.');
		expect(dialog).toHaveTextContent('Its history stays with the project.');
		expect(ondelete).not.toHaveBeenCalled();

		await user.click(screen.getByRole('button', { name: 'Delete' }));
		expect(ondelete).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});
});
