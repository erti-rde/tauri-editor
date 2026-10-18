import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { Editor } from '@tiptap/core';

import UiHarness from '$lib/ui/UiHarness.svelte';

import { editorExtensions } from '../core/extensions';
import ToolBar from './ToolBar.svelte';

/**
 * The manuscript toolbar on the toolbar primitives (M5-8): toggles say whether
 * they're on, actions don't pretend to be toggles, and it's one stop for Tab.
 */

let editor: Editor;

/** The toolbar for a manuscript, with the cursor at `at` when it's given. */
function mount(html: string, at?: number) {
	editor = new Editor({ extensions: editorExtensions, content: html });
	if (at !== undefined) editor.commands.setTextSelection(at);
	const exports = { pdf: vi.fn(), word: vi.fn(), latex: vi.fn() };
	return render(UiHarness, {
		props: { component: ToolBar, editor, toggleView: vi.fn(), exports }
	});
}

afterEach(() => editor?.destroy());

describe('the manuscript toolbar', () => {
	it('is one toolbar, named for what it acts on', () => {
		mount('<p>Attention</p>');
		expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
	});

	it('says which styles are on at the cursor, as pressed toggles', () => {
		mount('<p><strong>Attention</strong> replaced recurrence</p>', 3);

		const bold = screen.getByRole('button', { name: 'Bold' });
		const italic = screen.getByRole('button', { name: 'Italic' });
		expect(bold).toHaveAttribute('aria-pressed', 'true');
		expect(italic).toHaveAttribute('aria-pressed', 'false');
	});

	it('leaves actions as actions: they have no pressed state to say', () => {
		mount('<p>Attention</p>');
		for (const name of ['Insert a page break', 'Add the references section', 'Insert a table']) {
			expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-pressed');
		}
	});

	it('gives the link and table popovers one control each, not a button in a button', () => {
		mount('<p>Attention</p>');
		const link = screen.getByRole('button', { name: 'Link' });
		expect(link.parentElement?.closest('button')).toBeNull();
		expect(link).toHaveAttribute('aria-haspopup', 'dialog');
	});

	it('is passed through with one Tab', async () => {
		const user = userEvent.setup();
		mount('<p>Attention</p>');
		screen.getByRole('button', { name: 'Bold' }).focus();

		await user.tab();
		expect(document.activeElement?.closest('[role="toolbar"]')).toBeNull();
	});
});
