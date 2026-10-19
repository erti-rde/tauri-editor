import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import SplitHandle from './SplitHandle.svelte';

/**
 * M5-9 AC-1: the split between two panes is dragged, or moved from the
 * keyboard, and never leaves a pane under 280 px.
 */

function mount(props: Partial<{ value: number; min: number; max: number }> = {}) {
	const onchange = vi.fn();
	render(SplitHandle, {
		props: { label: 'Resize the split', value: 0.5, min: 0.25, max: 0.75, onchange, ...props }
	});
	return { handle: screen.getByRole('separator', { name: 'Resize the split' }), onchange };
}

/** A pointer event with a position, which jsdom's `fireEvent` would drop. */
function pointer(type: string, clientX: number) {
	return new MouseEvent(type, { clientX, button: 0, bubbles: true, cancelable: true });
}

describe('SplitHandle', () => {
	it('M5-9 AC-1: is a separator to focus, said as a percentage between its limits', () => {
		const { handle } = mount();
		expect(handle).toHaveAttribute('aria-orientation', 'vertical');
		expect(handle).toHaveAttribute('tabindex', '0');
		expect(handle).toHaveAttribute('aria-valuenow', '50');
		expect(handle).toHaveAttribute('aria-valuemin', '25');
		expect(handle).toHaveAttribute('aria-valuemax', '75');
		expect(handle).toHaveAttribute('aria-valuetext', '50% of the width on the left');
	});

	it('M5-9 AC-1: moves by 2% with the arrow keys, and to its limits with Home and End', async () => {
		const user = userEvent.setup();
		const { handle, onchange } = mount();
		handle.focus();

		await user.keyboard('{ArrowRight}');
		expect(handle).toHaveAttribute('aria-valuenow', '52');
		expect(onchange).toHaveBeenLastCalledWith(0.52);
		await user.keyboard('{ArrowLeft}{ArrowLeft}');
		expect(handle).toHaveAttribute('aria-valuenow', '48');

		await user.keyboard('{End}');
		expect(handle).toHaveAttribute('aria-valuenow', '75');
		// At the limit, a further press changes nothing, and says nothing changed.
		onchange.mockClear();
		await user.keyboard('{ArrowRight}');
		expect(handle).toHaveAttribute('aria-valuenow', '75');
		expect(onchange).not.toHaveBeenCalled();

		await user.keyboard('{Home}');
		expect(handle).toHaveAttribute('aria-valuenow', '25');
	});

	it('M5-9 AC-1: goes back to even on a double-click', async () => {
		const user = userEvent.setup();
		const { handle, onchange } = mount({ value: 0.7 });
		await user.dblClick(handle);
		expect(handle).toHaveAttribute('aria-valuenow', '50');
		expect(onchange).toHaveBeenLastCalledWith(0.5);
	});

	it('M5-9 AC-1: follows the pointer across the row, within its limits, and says where it was let go', async () => {
		const { handle, onchange } = mount();
		// A row 1008 px wide from x = 0, the handle 8 px of it: 1000 px to share.
		const row = handle.parentElement!;
		vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1008, 600));
		vi.spyOn(handle, 'getBoundingClientRect').mockReturnValue(new DOMRect(500, 0, 8, 600));

		await fireEvent(handle, pointer('pointerdown', 504));
		await fireEvent(handle, pointer('pointermove', 304));
		expect(handle).toHaveAttribute('aria-valuenow', '30');
		// Not saved mid-drag: only where it's let go counts.
		expect(onchange).not.toHaveBeenCalled();

		await fireEvent(handle, pointer('pointermove', 104));
		expect(handle).toHaveAttribute('aria-valuenow', '25');

		await fireEvent(handle, pointer('pointermove', 604));
		await fireEvent(handle, pointer('pointerup', 604));
		expect(handle).toHaveAttribute('aria-valuenow', '60');
		expect(onchange).toHaveBeenCalledExactlyOnceWith(0.6);

		// Released, the pointer moving over it moves nothing.
		await fireEvent(handle, pointer('pointermove', 204));
		expect(handle).toHaveAttribute('aria-valuenow', '60');
	});

	it('M5-9 AC-1: draws a share kept from a wider window within today’s limits', () => {
		const { handle } = mount({ value: 0.1 });
		expect(handle).toHaveAttribute('aria-valuenow', '25');
	});
});
