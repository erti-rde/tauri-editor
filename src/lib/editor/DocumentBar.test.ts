import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import DocumentBar from './DocumentBar.svelte';

afterEach(() => cleanup());

/**
 * Open the naming field and type a name. The field is returned so a test can
 * blur it after it has left the page: browsers blur a focused element as it
 * is removed, which jsdom doesn't, so the tests send that blur themselves.
 */
async function nameNewDocument(name: string) {
	const oncreate = vi.fn();
	const view = render(DocumentBar, {
		props: { documents: [], current: null, onopen: vi.fn(), oncreate, onhistory: vi.fn() }
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
		const view = render(DocumentBar, {
			props: {
				documents: [chapter],
				current: chapter,
				onopen: vi.fn(),
				oncreate: vi.fn(),
				onhistory
			}
		});

		view.getByRole('button', { name: 'Document menu for Chapter 1' }).focus();
		await user.keyboard('{Enter}');
		// jsdom never positions the menu, so it counts as hidden (primitives.test.ts).
		const [history] = await screen.findAllByRole('menuitem', { hidden: true });
		expect(history.textContent?.trim()).toBe('History…');
		await waitFor(() => expect(document.activeElement).toBe(history), { timeout: 5000 });
		await user.keyboard('{Enter}');

		expect(onhistory).toHaveBeenCalledTimes(1);
	});

	it('isn’t there without an open document', () => {
		const view = render(DocumentBar, {
			props: {
				documents: [],
				current: null,
				onopen: vi.fn(),
				oncreate: vi.fn(),
				onhistory: vi.fn()
			}
		});
		expect(view.queryByRole('button', { name: /Document menu/ })).toBeNull();
	});
});
