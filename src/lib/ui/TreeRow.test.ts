import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import TreeHarness from './TreeHarness.svelte';

/**
 * `TreeRow` (M6-8, docs/design-system.md): the rows of Files and Outline,
 * with the WAI-ARIA tree's keys.
 */

const row = (name: string) => screen.getByRole('treeitem', { name: new RegExp(`^${name}`) });

describe('TreeRow', () => {
	it('M6-8 AC-1: is one stop for Tab, landing on the row given it', async () => {
		const user = userEvent.setup();
		render(TreeHarness);

		screen.getByRole('button', { name: 'Before' }).focus();
		await user.tab();
		expect(row('Thesis')).toHaveFocus();
		await user.tab();
		expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
	});

	it('M6-8 AC-1: moves with Up, Down, Home and End', async () => {
		const user = userEvent.setup();
		render(TreeHarness);

		row('Thesis').focus();
		await user.keyboard('{ArrowDown}');
		expect(row('Chapter 1')).toHaveFocus();
		await user.keyboard('{ArrowDown}{ArrowDown}');
		expect(row('Notes.txt')).toHaveFocus();
		await user.keyboard('{ArrowDown}');
		expect(row('Notes.txt')).toHaveFocus();
		await user.keyboard('{Home}');
		expect(row('Thesis')).toHaveFocus();
		await user.keyboard('{End}');
		expect(row('Notes.txt')).toHaveFocus();
		await user.keyboard('{ArrowUp}');
		expect(row('Chapter 2')).toHaveFocus();
	});

	it('M6-8 AC-1: closes and opens a branch with Left and Right, and goes up to its parent', async () => {
		const user = userEvent.setup();
		render(TreeHarness);

		row('Chapter 2').focus();
		await user.keyboard('{ArrowLeft}');
		expect(row('Thesis')).toHaveFocus();

		await user.keyboard('{ArrowLeft}');
		expect(row('Thesis')).toHaveAttribute('aria-expanded', 'false');
		expect(screen.queryByRole('treeitem', { name: /^Chapter 1/ })).not.toBeInTheDocument();

		await user.keyboard('{ArrowRight}');
		expect(row('Thesis')).toHaveAttribute('aria-expanded', 'true');
		await user.keyboard('{ArrowRight}');
		expect(row('Chapter 1')).toHaveFocus();
	});

	it('M6-8 AC-1: chooses with Enter, Space and a click', async () => {
		const user = userEvent.setup();
		const onselect = vi.fn();
		render(TreeHarness, { props: { onselect } });

		row('Chapter 2').focus();
		await user.keyboard('{Enter}');
		await user.keyboard(' ');
		await user.click(row('Notes.txt'));
		expect(onselect.mock.calls).toEqual([['Chapter 2'], ['Chapter 2'], ['Notes.txt']]);
	});

	it('M6-8 AC-1: says its depth, and which row is chosen in words as well as by its ground', () => {
		render(TreeHarness);

		expect(row('Thesis')).toHaveAttribute('aria-level', '1');
		expect(row('Chapter 1')).toHaveAttribute('aria-level', '2');
		expect(row('Chapter 1')).toHaveAttribute('aria-selected', 'true');
		expect(row('Chapter 1')).toHaveTextContent('open');
		expect(row('Chapter 2')).toHaveAttribute('aria-selected', 'false');
		// A leaf has no expanded state to report.
		expect(row('Notes.txt')).not.toHaveAttribute('aria-expanded');
	});
});
