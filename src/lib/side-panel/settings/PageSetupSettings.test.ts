import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

/**
 * Settings › Page setup, mounted. It had no test of its own until it moved
 * onto the primitives (M6-8).
 */

const update = vi.fn(async () => {});

vi.mock('$lib/editor/pagination', async (original) => {
	const { writable } = await import('svelte/store');
	const actual = await original<typeof import('$lib/editor/pagination')>();

	return {
		...actual,
		pageSetupStore: {
			subscribe: writable(actual.DEFAULT_PAGE_SETUP).subscribe,
			update,
			reset: vi.fn()
		}
	};
});

const { default: PageSetupSettings } = await import('./PageSetupSettings.svelte');

describe('Settings › Page setup', () => {
	it('M6-8 AC-1: paper, margins and spacing are card groups named by their rows', () => {
		render(PageSetupSettings);

		for (const name of ['Paper size', 'Margins', 'Line spacing']) {
			const group = screen.getByRole('radiogroup', { name });
			expect(group).toHaveAccessibleDescription();
		}
		expect(screen.getByRole('radio', { name: /Letter/ })).toHaveAttribute('aria-checked', 'true');
	});

	it('M6-8 AC-1: header and footer are labelled fields, applied as they are typed', async () => {
		const user = userEvent.setup();
		update.mockClear();
		render(PageSetupSettings);

		const header = screen.getByRole('textbox', { name: 'Header, left' });
		expect(header).toHaveAccessibleDescription('Often a running title');
		await user.type(header, 'A');
		expect(update).toHaveBeenLastCalledWith({
			runningHeads: expect.objectContaining({ headerLeft: 'A' })
		});
	});

	it('M6-8 AC-1: the two that take effect at once are switches', async () => {
		const user = userEvent.setup();
		update.mockClear();
		render(PageSetupSettings);

		await user.click(screen.getByRole('switch', { name: 'Show page breaks while writing' }));
		expect(update).toHaveBeenLastCalledWith({ paginate: false });
		expect(screen.getByRole('switch', { name: 'Leave the first page bare' })).toBeInTheDocument();
	});
});
