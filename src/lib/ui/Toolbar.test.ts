import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Component, ComponentProps } from 'svelte';
import Bold from '~icons/lucide/bold';

import ToolbarHarness from './ToolbarHarness.svelte';
import UiHarness from './UiHarness.svelte';
import { NumberField, ToggleButton } from './index';

/**
 * The toolbar primitives (M5-8, docs/design-system.md): `Toolbar` and its
 * groups, `ToggleButton`, and `NumberField`, which the font size is typed into.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = <C extends Component<any>>(component: C, props: Partial<ComponentProps<C>>) =>
	render(UiHarness, { props: { component, ...props } });

describe('Toolbar', () => {
	it('is one stop for Tab, in either direction', async () => {
		const user = userEvent.setup();
		render(ToolbarHarness);

		screen.getByRole('button', { name: 'Before' }).focus();
		await user.tab();
		expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
		await user.tab();
		expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();

		await user.tab({ shift: true });
		expect(screen.getByRole('button', { name: 'Text style' })).toHaveFocus();
		await user.tab({ shift: true });
		expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
	});

	it('moves along with the arrows, Home and End, past what’s disabled', async () => {
		const user = userEvent.setup();
		render(ToolbarHarness);
		const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
		screen.getByRole('button', { name: 'Undo' }).focus();

		// Redo is disabled, and the steppers are the size box's own arrows.
		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('spinbutton', { name: 'Font size' })).toHaveFocus();
		screen.getByRole('button', { name: 'Bold' }).focus();
		await user.keyboard('{ArrowRight}{ArrowRight}');
		expect(screen.getByRole('button', { name: 'Text style' })).toHaveFocus();
		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
		await user.keyboard('{ArrowLeft}');
		expect(screen.getByRole('button', { name: 'Text style' })).toHaveFocus();
		await user.keyboard('{Home}');
		expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
		await user.keyboard('{End}');
		expect(screen.getByRole('button', { name: 'Text style' })).toHaveFocus();
		expect(toolbar).toHaveAttribute('aria-orientation', 'horizontal');
	});

	it('leaves the arrows in a text box to the caret', async () => {
		const user = userEvent.setup();
		render(ToolbarHarness);
		const size = screen.getByRole('spinbutton', { name: 'Font size' });
		size.focus();

		await user.keyboard('{ArrowLeft}{End}');
		expect(size).toHaveFocus();
	});

	it('keeps focus in a number box when its stepper is pressed', async () => {
		// Otherwise a click leaves it on a stepper, which the toolbar doesn't
		// count, and the next Tab stops at Bold instead of leaving.
		const user = userEvent.setup();
		render(ToolbarHarness);
		const size = screen.getByRole('spinbutton', { name: 'Font size' });
		size.focus();

		await user.click(screen.getByRole('button', { name: 'Larger' }));

		expect(size).toHaveFocus();
		expect(size).toHaveValue('17');
		await user.tab();
		expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
	});

	it('names its groups when asked, and rules them apart', () => {
		render(ToolbarHarness);
		const groups = screen.getAllByRole('group');
		expect(groups).toHaveLength(3);
		expect(groups[1].className).toContain('not-first:before:bg-line');
	});
});

describe('ToggleButton', () => {
	it('always says whether it’s on, and is named by its label', async () => {
		const user = userEvent.setup();
		render(ToolbarHarness);
		const bold = screen.getByRole('button', { name: 'Bold' });
		const italic = screen.getByRole('button', { name: 'Italic' });

		expect(bold).toHaveAttribute('aria-pressed', 'true');
		expect(italic).toHaveAttribute('aria-pressed', 'false');
		await user.click(italic);
		expect(italic).toHaveAttribute('aria-pressed', 'true');
	});

	it('can’t be pressed while disabled', async () => {
		const user = userEvent.setup();
		const onclick = vi.fn();
		mount(ToggleButton, { label: 'Bold', icon: Bold, pressed: false, disabled: true, onclick });

		await user.click(screen.getByRole('button', { name: 'Bold' }));
		expect(onclick).not.toHaveBeenCalled();
	});
});

describe('NumberField', () => {
	const field = (props: Partial<ComponentProps<typeof NumberField>> = {}) => {
		const onchange = vi.fn();
		mount(NumberField, {
			label: 'Font size',
			value: 16,
			min: 8,
			max: 72,
			unit: 'px',
			steppers: true,
			stepLabels: ['Smaller', 'Larger'],
			noun: 'a size',
			onchange,
			...props
		});
		return { onchange, box: screen.getByRole('spinbutton', { name: 'Font size' }) };
	};

	it('is a spinbutton that says its number, range and unit', () => {
		const { box } = field();
		expect(box).toHaveValue('16');
		expect(box).toHaveAttribute('aria-valuenow', '16');
		expect(box).toHaveAttribute('aria-valuemin', '8');
		expect(box).toHaveAttribute('aria-valuemax', '72');
		expect(box).toHaveAttribute('aria-valuetext', '16 px');
	});

	it('steps with the arrows, by ten with Shift, and stops at the ends', async () => {
		const user = userEvent.setup();
		const { onchange, box } = field();
		box.focus();

		await user.keyboard('{ArrowUp}');
		expect(onchange).toHaveBeenLastCalledWith(17);
		await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
		expect(onchange).toHaveBeenLastCalledWith(8);
		await user.keyboard('{ArrowDown}');
		expect(onchange).toHaveBeenCalledTimes(2);
		expect(box).toHaveValue('8');
	});

	it('takes a typed number on Enter, not as each digit is typed', async () => {
		const user = userEvent.setup();
		const { onchange, box } = field();

		await user.clear(box);
		await user.type(box, '12');
		expect(onchange).not.toHaveBeenCalled();
		await user.keyboard('{Enter}');
		expect(onchange).toHaveBeenCalledExactlyOnceWith(12);
	});

	it('reads "14px" as fourteen, and takes it on leaving the field', async () => {
		const user = userEvent.setup();
		const { onchange, box } = field();

		await user.clear(box);
		await user.type(box, '14px');
		await fireEvent.blur(box);
		expect(onchange).toHaveBeenCalledExactlyOnceWith(14);
	});

	it('says what range a number must be in, and puts the last good one back on leaving', async () => {
		const user = userEvent.setup();
		const { onchange, box } = field();

		await user.clear(box);
		await user.type(box, '140{Enter}');
		expect(box).toHaveAttribute('aria-invalid', 'true');
		expect(box).toHaveAccessibleDescription('Enter a size from 8 to 72.');
		expect(onchange).not.toHaveBeenCalled();

		await fireEvent.blur(box);
		expect(box).toHaveValue('16');
		expect(box).not.toHaveAttribute('aria-invalid');
	});

	it('puts the number back on Escape', async () => {
		const user = userEvent.setup();
		const { onchange, box } = field();

		await user.clear(box);
		await user.type(box, '30{Escape}');
		expect(box).toHaveValue('16');
		expect(onchange).not.toHaveBeenCalled();
	});

	it('steps from the mouse, with steppers that are out of the tab order', async () => {
		const user = userEvent.setup();
		const { onchange } = field({ value: 71 });
		const larger = screen.getByRole('button', { name: 'Larger' });

		expect(larger).toHaveAttribute('tabindex', '-1');
		await user.click(larger);
		expect(onchange).toHaveBeenCalledExactlyOnceWith(72);
		expect(larger).toBeDisabled();
	});

	it('keeps to the places of its step', async () => {
		const user = userEvent.setup();
		const { onchange, box } = field({ value: 1.1, min: 1, max: 2, step: 0.1, unit: undefined });
		box.focus();

		await user.keyboard('{ArrowUp}');
		expect(onchange).toHaveBeenLastCalledWith(1.2);
		expect(box).toHaveValue('1.2');
	});
});
