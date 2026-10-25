import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import ComboboxHarness from './ComboboxHarness.svelte';

/**
 * Combobox (M6-8): the list half of a combobox, driven by a field that keeps
 * focus, as the manuscript does for the citation picker.
 */

const sources = [
	{ id: 'vaswani', title: 'Attention Is All You Need' },
	{ id: 'nameless', title: 'A source with no authors', cannot: true },
	{ id: 'bahdanau', title: 'Neural Machine Translation by Jointly Learning to Align' }
];

const setup = (props: Partial<{ multiple: boolean; onchoose: () => void }> = {}) => {
	const user = userEvent.setup();
	render(ComboboxHarness, { props: { items: sources, ...props } });
	const field = screen.getByRole('textbox', { name: 'Query' });
	field.focus();
	return { user, field };
};

describe('Combobox', () => {
	it('M6-8 AC-1: is a named listbox the field says it controls', () => {
		const { field } = setup();

		const list = screen.getByRole('listbox', { name: 'Sources' });
		expect(screen.getAllByRole('option')).toHaveLength(3);
		expect(field).toHaveAttribute('aria-controls', list.id);
		expect(field).toHaveAttribute('aria-expanded', 'true');
	});

	it('M6-8 AC-1: moves with the arrow keys, wrapping, while the field keeps focus', async () => {
		const { user, field } = setup();
		const [first, , last] = screen.getAllByRole('option');

		expect(field).toHaveAttribute('aria-activedescendant', first.id);
		await user.keyboard('{ArrowUp}');
		expect(field).toHaveAttribute('aria-activedescendant', last.id);
		await user.keyboard('{ArrowDown}');
		expect(field).toHaveAttribute('aria-activedescendant', first.id);
		expect(field).toHaveFocus();
	});

	it('M6-8 AC-1: Enter or a click chooses, and an option that cannot be chosen is said so', async () => {
		const onchoose = vi.fn();
		const { user, field } = setup({ onchoose });

		await user.keyboard('{Enter}');
		expect(onchoose).toHaveBeenLastCalledWith(sources[0]);

		const nameless = screen.getByRole('option', { name: /no authors/ });
		expect(nameless).toHaveAttribute('aria-disabled', 'true');
		await user.keyboard('{ArrowDown}{Enter}');
		await user.click(nameless);
		expect(onchoose).toHaveBeenCalledTimes(1);

		await user.click(screen.getByRole('option', { name: /Neural Machine/ }));
		expect(onchoose).toHaveBeenLastCalledWith(sources[2]);
		// Pressed with the pointer, and the caret is still in the field.
		expect(field).toHaveFocus();
	});

	it('M6-8 AC-1: when several can be chosen, says which are', async () => {
		const { user } = setup({ multiple: true });

		expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
		const first = screen.getByRole('option', { name: /Attention/ });
		expect(first).toHaveAttribute('aria-selected', 'false');
		await user.keyboard('{Enter}');
		expect(first).toHaveAttribute('aria-selected', 'true');
		await user.keyboard('{Enter}');
		expect(first).toHaveAttribute('aria-selected', 'false');
	});

	it('says what kind of nothing there is, and lets the keys pass', async () => {
		const user = userEvent.setup();
		const onkeydown = vi.fn();
		render(ComboboxHarness, { props: { items: [] } });
		const field = screen.getByRole('textbox', { name: 'Query' });
		field.addEventListener('keydown', onkeydown);
		field.focus();

		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		expect(screen.getByText('No sources match.')).toBeInTheDocument();
		expect(field).not.toHaveAttribute('aria-activedescendant');
		await user.keyboard('{Enter}');
		expect(onkeydown.mock.calls[0][0].defaultPrevented).toBe(false);
	});
});
