import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import FindBar from './FindBar.svelte';
import UiHarness from './UiHarness.svelte';

/**
 * The find bar as a primitive (docs/design-system.md): the fields, the count
 * and the keys, with the searching left to whoever uses it. The manuscript's
 * is tested in `editor/ManuscriptFind.test.ts`, the reader's in its toolbar.
 */

function show(props: Record<string, unknown> = {}) {
	const handlers = {
		onstep: vi.fn(),
		onclose: vi.fn(),
		onquery: vi.fn(),
		onreplace: vi.fn(),
		onreplaceall: vi.fn()
	};
	render(UiHarness, {
		props: { component: FindBar, status: '2 of 5', found: true, ...handlers, ...props }
	});
	return { ...handlers, user: userEvent.setup() };
}

const findField = () => screen.getByRole('textbox', { name: 'Find' });

describe('FindBar', () => {
	it('says where the count stands beside the query', () => {
		show();

		expect(screen.getByRole('status')).toHaveTextContent('2 of 5');
	});

	it('steps with Enter and Shift Enter, and with the arrows', async () => {
		const { user, onstep } = show();

		await user.type(findField(), 'one{Enter}');
		await user.keyboard('{Shift>}{Enter}{/Shift}');
		await user.click(screen.getByRole('button', { name: 'Next match' }));
		await user.click(screen.getByRole('button', { name: 'Previous match' }));

		expect(onstep.mock.calls).toEqual([[1], [-1], [1], [-1]]);
	});

	it('passes the query on as it is typed', async () => {
		const { user, onquery } = show();

		await user.type(findField(), 'ab');

		expect(onquery).toHaveBeenLastCalledWith('ab');
	});

	it('has nowhere to go when nothing matched', () => {
		show({ status: 'No matches', found: false });

		expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Previous match' })).toBeDisabled();
	});

	it('closes on Esc and from the button', async () => {
		const { user, onclose } = show();

		await user.type(findField(), '{Escape}');
		await user.click(screen.getByRole('button', { name: 'Close find' }));

		expect(onclose).toHaveBeenCalledTimes(2);
	});

	it('shows match case and whole word only where they’re bound, saying when they’re on', async () => {
		show();
		expect(screen.queryByRole('button', { name: 'Match case' })).not.toBeInTheDocument();

		const { user } = show({ caseSensitive: false, wholeWord: true });
		const matchCase = screen.getByRole('button', { name: 'Match case' });
		await user.click(matchCase);

		expect(matchCase).toHaveAttribute('aria-pressed', 'true');
		expect(screen.getByRole('button', { name: 'Whole word' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	it('shows the replace row behind a disclosure, only where it can replace', async () => {
		const { user } = show();
		const disclosure = screen.getByRole('button', { name: 'Show replace' });
		expect(disclosure).toHaveAttribute('aria-expanded', 'false');

		await user.click(disclosure);

		expect(screen.getByRole('button', { name: 'Hide replace' })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		expect(screen.getByRole('textbox', { name: 'Replace with' })).toBeInTheDocument();
	});

	it('has no replace for text that can’t be changed, such as a paper', () => {
		show({ onreplace: undefined, onreplaceall: undefined, replacing: true });

		expect(screen.queryByRole('button', { name: 'Show replace' })).not.toBeInTheDocument();
		expect(screen.queryByRole('textbox', { name: 'Replace with' })).not.toBeInTheDocument();
	});

	it('replaces the current match with Enter, and every one with Replace all', async () => {
		const { user, onreplace, onreplaceall } = show({ replacing: true });

		await user.type(screen.getByRole('textbox', { name: 'Replace with' }), 'color{Enter}');
		await user.click(screen.getByRole('button', { name: 'Replace all' }));

		expect(onreplace).toHaveBeenCalledWith('color');
		expect(onreplaceall).toHaveBeenCalledWith('color');
	});

	it('can’t replace in text open read-only, or with nothing found', async () => {
		show({ replacing: true, readOnly: true });
		expect(screen.getByRole('textbox', { name: 'Replace with' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Replace all' })).toBeDisabled();
	});

	it('takes the reader’s name for its field', () => {
		show({ label: 'Find in this paper' });

		expect(screen.getByRole('textbox', { name: 'Find in this paper' })).toBeInTheDocument();
	});
});
