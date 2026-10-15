import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Component, ComponentProps } from 'svelte';
import FileText from '~icons/lucide/file-text';

import UiHarness from './UiHarness.svelte';
import { DocumentTab, InlineRename } from './index';

/**
 * The document tab and renaming in place (M5-7, docs/ux.md UX-9): the two
 * primitives the document menu is built from.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = <C extends Component<any>>(component: C, props: Partial<ComponentProps<C>>) =>
	render(UiHarness, { props: { component, ...props } });

describe('InlineRename', () => {
	const rename = (props: Partial<ComponentProps<typeof InlineRename>> = {}) => {
		const oncommit = vi.fn();
		const oncancel = vi.fn();
		mount(InlineRename, {
			value: 'Chapter 1',
			label: 'Name for Chapter 1',
			oncommit,
			oncancel,
			...props
		});
		return {
			oncommit,
			oncancel,
			field: screen.getByRole('textbox', { name: 'Name for Chapter 1' })
		};
	};

	it('opens focused with the name selected, so typing replaces it', () => {
		const { field } = rename();

		expect(field).toHaveFocus();
		expect(field).toHaveValue('Chapter 1');
		expect((field as HTMLInputElement).selectionStart).toBe(0);
		expect((field as HTMLInputElement).selectionEnd).toBe('Chapter 1'.length);
	});

	it('renames on Enter, once, with the name trimmed', async () => {
		const user = userEvent.setup();
		const { oncommit, oncancel, field } = rename();

		await user.keyboard('  Introduction {Enter}');
		await fireEvent.blur(field);

		expect(oncommit).toHaveBeenCalledTimes(1);
		expect(oncommit).toHaveBeenCalledWith('Introduction');
		expect(oncancel).not.toHaveBeenCalled();
	});

	it('puts the old name back on Escape, and the blur after it renames nothing', async () => {
		const user = userEvent.setup();
		const { oncommit, oncancel, field } = rename();

		await user.keyboard('Introduction{Escape}');
		await fireEvent.blur(field);

		expect(oncommit).not.toHaveBeenCalled();
		expect(oncancel).toHaveBeenCalledTimes(1);
	});

	it('renames when clicked away from', async () => {
		const user = userEvent.setup();
		const { oncommit, field } = rename();

		await user.keyboard('Introduction');
		await fireEvent.blur(field);

		expect(oncommit).toHaveBeenCalledWith('Introduction');
	});

	it('renames nothing when the name is unchanged or empty', async () => {
		const user = userEvent.setup();
		const { oncommit, oncancel } = rename();

		await user.keyboard('Chapter 1 {Enter}');

		expect(oncommit).not.toHaveBeenCalled();
		expect(oncancel).toHaveBeenCalledTimes(1);
	});

	it('says why a name can’t be used, beside the field, and waits for another', async () => {
		const user = userEvent.setup();
		const { oncommit, oncancel, field } = rename({
			validate: (name) => (name === 'Methods' ? '“Methods” is already in this project.' : undefined)
		});

		await user.keyboard('Methods{Enter}');

		expect(field).toHaveAttribute('aria-invalid', 'true');
		expect(field).toHaveAccessibleDescription('“Methods” is already in this project.');
		expect(oncommit).not.toHaveBeenCalled();
		expect(oncancel).not.toHaveBeenCalled();

		await user.keyboard(' 2{Enter}');
		expect(oncommit).toHaveBeenCalledWith('Methods 2');
	});

	it('puts the old name back when clicked away from with one that can’t be used', async () => {
		const user = userEvent.setup();
		const { oncommit, oncancel, field } = rename({ validate: () => 'No.' });

		await user.keyboard('Methods');
		await fireEvent.blur(field);

		expect(oncommit).not.toHaveBeenCalled();
		expect(oncancel).toHaveBeenCalledTimes(1);
	});

	it('keeps its keys from a menu or editor around it', async () => {
		const user = userEvent.setup();
		const outside = vi.fn();
		document.addEventListener('keydown', outside);
		rename();

		await user.keyboard('a{Enter}');
		document.removeEventListener('keydown', outside);

		expect(outside).not.toHaveBeenCalled();
	});
});

describe('DocumentTab', () => {
	const MENU = [
		{ label: 'Rename…', onSelect: vi.fn() },
		{ label: 'Delete…', danger: true, onSelect: vi.fn() }
	];

	it('is a tab, selected when current, and chosen with Enter', async () => {
		const user = userEvent.setup();
		const onselect = vi.fn();
		mount(DocumentTab, { title: 'Chapter 1', icon: FileText, current: true, onselect });

		const tab = screen.getByRole('tab', { name: 'Chapter 1' });
		expect(tab).toHaveAttribute('aria-selected', 'true');
		tab.focus();
		await user.keyboard('{Enter}');
		expect(onselect).toHaveBeenCalledTimes(1);
	});

	it('shows its ⋯ menu on the current tab only', async () => {
		const user = userEvent.setup();
		const { unmount } = mount(DocumentTab, {
			title: 'Methods',
			menu: MENU,
			onselect: () => {}
		});
		expect(screen.queryByRole('button', { name: 'Methods menu' })).toBeNull();
		unmount();

		mount(DocumentTab, { title: 'Chapter 1', current: true, menu: MENU, onselect: () => {} });
		screen.getByRole('button', { name: 'Chapter 1 menu' }).focus();
		await user.keyboard('{Enter}');

		const items = await screen.findAllByRole('menuitem', { hidden: true });
		expect(items.map((item) => item.textContent?.trim())).toEqual(['Rename…', 'Delete…']);
	});

	it('closes from its named button or a middle-click, without choosing the tab', async () => {
		const user = userEvent.setup();
		const onselect = vi.fn();
		const onclose = vi.fn();
		mount(DocumentTab, { title: 'vaswani-2017.pdf', onselect, onclose });

		await user.click(screen.getByRole('button', { name: 'Close vaswani-2017.pdf' }));
		await fireEvent(
			screen.getByRole('tab', { name: /vaswani/ }),
			new MouseEvent('auxclick', { button: 1, bubbles: true })
		);

		expect(onclose).toHaveBeenCalledTimes(2);
		expect(onselect).not.toHaveBeenCalled();
	});

	it('changes its name in place while renaming', async () => {
		const user = userEvent.setup();
		const onrename = vi.fn();
		const onselect = vi.fn();
		mount(DocumentTab, {
			title: 'Chapter 1',
			current: true,
			menu: MENU,
			renaming: true,
			onselect,
			onrename
		});

		// The menu waits until the name is settled.
		expect(screen.queryByRole('button', { name: 'Chapter 1 menu' })).toBeNull();
		await user.keyboard('Introduction{Enter}');

		expect(onrename).toHaveBeenCalledWith('Introduction');
		expect(onselect).not.toHaveBeenCalled();
	});
});
