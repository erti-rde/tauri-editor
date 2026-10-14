import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import { Editor } from '$lib/editor/core/Editor';
import { editorExtensions } from '$lib/editor/core/extensions';
import UiHarness from '$lib/ui/UiHarness.svelte';

import FindBar from './FindBar.svelte';
import { findState } from './extensions/FindReplace';

/**
 * The find bar (M5-2, UX-11) over a real editor built from the app's own
 * extensions: the searching itself is tested in `FindReplace.test.ts`.
 */

let editor: Editor | undefined;

afterEach(() => {
	editor?.destroy();
	editor = undefined;
});

function show(content: string, props: { replacing?: boolean } = {}) {
	editor = new Editor({
		element: document.createElement('div'),
		extensions: editorExtensions,
		content
	});
	const onclose = vi.fn();
	render(UiHarness, {
		props: { component: FindBar, editor, replacing: false, onclose, ...props }
	});
	return { editor, onclose, user: userEvent.setup() };
}

const count = () => screen.getByRole('status');
const findField = () => screen.getByRole('textbox', { name: 'Find' });

describe('the find bar', () => {
	// M5-2 AC-1
	it('opens with the cursor in the find field', () => {
		show('<p>Attention</p>');

		expect(findField()).toHaveFocus();
		expect(screen.queryByRole('textbox', { name: 'Replace with' })).not.toBeInTheDocument();
	});

	// M5-2 AC-2
	it('counts the matches, and steps through them with Enter and the arrows', async () => {
		const { user, editor } = show('<p>one two one two one</p>');

		await user.type(findField(), 'one');
		expect(count()).toHaveTextContent('1 of 3');

		await user.keyboard('{Enter}');
		expect(count()).toHaveTextContent('2 of 3');
		await user.keyboard('{Shift>}{Enter}{/Shift}');
		await user.keyboard('{Shift>}{Enter}{/Shift}');
		expect(count()).toHaveTextContent('3 of 3');

		await user.click(screen.getByRole('button', { name: 'Next match' }));
		expect(count()).toHaveTextContent('1 of 3');
		await user.click(screen.getByRole('button', { name: 'Previous match' }));
		expect(count()).toHaveTextContent('3 of 3');
		expect(editor.view.dom.querySelectorAll('.erti-find-current')).toHaveLength(1);
	});

	// M5-2 AC-2
	it('matches case and whole words when asked, saying so on the buttons', async () => {
		const { user } = show('<p>Art, art and artists</p>');
		await user.type(findField(), 'art');
		expect(count()).toHaveTextContent('1 of 3');

		const matchCase = screen.getByRole('button', { name: 'Match case' });
		await user.click(matchCase);
		expect(matchCase).toHaveAttribute('aria-pressed', 'true');
		expect(count()).toHaveTextContent('1 of 2');

		await user.click(screen.getByRole('button', { name: 'Whole word' }));
		expect(count()).toHaveTextContent('1 of 1');
	});

	it('says when nothing matches', async () => {
		const { user } = show('<p>one</p>');

		await user.type(findField(), 'two');

		expect(count()).toHaveTextContent('No matches');
		expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
	});

	it('starts from words selected in the manuscript', () => {
		editor = new Editor({
			element: document.createElement('div'),
			extensions: editorExtensions,
			content: '<p>the encoder and the encoder</p>'
		});
		editor.commands.setTextSelection({ from: 5, to: 12 });
		render(UiHarness, {
			props: { component: FindBar, editor, replacing: false, onclose: vi.fn() }
		});

		expect(findField()).toHaveValue('encoder');
		expect(count()).toHaveTextContent('1 of 2');
	});

	// M5-2 AC-1
	it('closes on Esc, and the highlights go with it', async () => {
		const { user, editor, onclose } = show('<p>one two one</p>');
		await user.type(findField(), 'one');

		await user.keyboard('{Escape}');

		expect(onclose).toHaveBeenCalled();
		expect(findState(editor.state).matches).toEqual([]);
		expect(editor.view.dom.querySelectorAll('.erti-find-match')).toHaveLength(0);
	});
});

describe('replacing from the bar', () => {
	// M5-2 AC-1
	it('shows the replace field when asked', async () => {
		const { user } = show('<p>one</p>');

		await user.click(screen.getByRole('button', { name: 'Replace' }));

		expect(screen.getByRole('textbox', { name: 'Replace with' })).toBeInTheDocument();
	});

	it('replaces the current match with Enter, then the rest with Replace all', async () => {
		const { user, editor } = show('<p>colour, colour, colour</p>', { replacing: true });
		await user.type(findField(), 'colour');
		await user.type(screen.getByRole('textbox', { name: 'Replace with' }), 'color{Enter}');

		expect(editor.getText()).toBe('color, colour, colour');
		expect(count()).toHaveTextContent('1 of 2');

		await user.click(screen.getByRole('button', { name: 'Replace all' }));
		expect(editor.getText()).toBe('color, color, color');
		expect(count()).toHaveTextContent('Replaced 2');
	});

	// M5-2 AC-3
	it('undoes Replace all in one step', async () => {
		const { user, editor } = show('<p>colour, colour, colour</p>', { replacing: true });
		await user.type(findField(), 'colour');
		await user.type(screen.getByRole('textbox', { name: 'Replace with' }), 'color');
		await user.click(screen.getByRole('button', { name: 'Replace all' }));

		editor.commands.undo();

		expect(editor.getText()).toBe('colour, colour, colour');
	});

	it('can’t replace in a document open read-only', async () => {
		editor = new Editor({
			element: document.createElement('div'),
			extensions: editorExtensions,
			content: '<p>colour</p>',
			editable: false
		});
		render(UiHarness, {
			props: { component: FindBar, editor, replacing: true, onclose: vi.fn() }
		});
		await userEvent.type(findField(), 'colour');

		expect(count()).toHaveTextContent('1 of 1');
		expect(screen.getByRole('button', { name: 'Replace all' })).toBeDisabled();
		expect(screen.getByRole('textbox', { name: 'Replace with' })).toBeDisabled();
	});
});
