import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Component, ComponentProps } from 'svelte';

import UiHarness from './UiHarness.svelte';
import { ColourField, Slider } from './index';

/** Slider and ColourField (M6-8), in place of `type="range"` and `type="color"`. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = <C extends Component<any>>(component: C, props: Partial<ComponentProps<C>>) =>
	render(UiHarness, { props: { component, ...props } });

// Portalled overlays are found whatever jsdom makes of their visibility. A
// hidden element has no accessible name there, so what's in one is found by
// its label instead.
const anyVisibility = { hidden: true } as const;

describe('Slider', () => {
	const size = { label: 'Interface size', min: 11, max: 18, unit: 'px' };

	it('M6-8 AC-1: is named by its label, and says its value with the unit', () => {
		mount(Slider, { ...size, value: 13, hint: 'Every size follows this one.' });

		const thumb = screen.getByRole('slider', { name: 'Interface size' });
		expect(thumb).toHaveAttribute('aria-valuenow', '13');
		expect(thumb).toHaveAttribute('aria-valuetext', '13 px');
		expect(thumb).toHaveAccessibleDescription('Every size follows this one.');
		// And on screen, beside the label, so nobody reads it off the thumb.
		expect(screen.getByText('13 px')).toBeInTheDocument();
	});

	it('M6-8 AC-1: steps with the arrow keys and goes to either end', async () => {
		const user = userEvent.setup();
		const onValueChange = vi.fn();
		mount(Slider, { ...size, value: 13, onValueChange });

		screen.getByRole('slider').focus();
		await user.keyboard('{ArrowRight}');
		expect(onValueChange).toHaveBeenLastCalledWith(14);
		await user.keyboard('{End}');
		expect(onValueChange).toHaveBeenLastCalledWith(18);
		await user.keyboard('{Home}');
		expect(onValueChange).toHaveBeenLastCalledWith(11);
	});

	it('M6-8 AC-1: marks the default in words', () => {
		mount(Slider, { ...size, value: 15, defaultValue: 13 });
		expect(screen.getByText('13 · default')).toBeInTheDocument();
	});

	it("can't be moved while disabled", async () => {
		const user = userEvent.setup();
		const onValueChange = vi.fn();
		mount(Slider, { ...size, value: 13, disabled: true, onValueChange });

		screen.getByRole('slider').focus();
		await user.keyboard('{ArrowRight}');
		expect(onValueChange).not.toHaveBeenCalled();
	});
});

describe('ColourField', () => {
	const swatches = [
		{ value: '45 95% 62%', name: 'Yellow' },
		{ value: '145 50% 55%', name: 'Green' },
		{ value: '210 80% 65%', name: 'Blue' }
	];

	it('M6-8 AC-1: says the colour in words on its trigger, not by colour alone', () => {
		mount(ColourField, { label: 'Colour for Claim', value: '45 95% 62%', swatches });
		expect(screen.getByRole('button', { name: 'Colour for Claim: Yellow' })).toHaveTextContent(
			'Yellow'
		);
	});

	it('M6-8 AC-1: offers named swatches, the chosen one checked, and a click chooses', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		mount(ColourField, { label: 'Colour for Claim', value: '45 95% 62%', swatches, onchange });

		await user.click(screen.getByRole('button', { name: /Colour for Claim/ }));
		const colours = await screen.findByRole('radiogroup', anyVisibility);
		expect(colours).toHaveAttribute('aria-label', 'Colour');
		expect(within(colours).getAllByRole('radio', anyVisibility)).toHaveLength(3);
		expect(screen.getByLabelText('Yellow')).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByLabelText('Green')).toHaveAttribute('aria-checked', 'false');

		await user.click(screen.getByLabelText('Green'));
		expect(onchange).toHaveBeenCalledWith('145 50% 55%');
	});

	it('M6-8 AC-1: keeps a colour of its own as "Custom" rather than calling it one of the swatches', async () => {
		const user = userEvent.setup();
		mount(ColourField, { label: 'Colour for Claim', value: '0 0% 50%', swatches });

		await user.click(screen.getByRole('button', { name: 'Colour for Claim: Custom' }));
		expect(await screen.findByLabelText('Custom')).toHaveAttribute('aria-checked', 'true');
	});

	it('M6-8 AC-1: resets to the default, and says when it is the default', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		const view = mount(ColourField, {
			label: 'Colour for Claim',
			value: '145 50% 55%',
			swatches,
			defaultValue: '45 95% 62%',
			onchange
		});

		await user.click(screen.getByRole('button', { name: /Colour for Claim/ }));
		await user.click(await screen.findByText('Reset to Yellow'));
		expect(onchange).toHaveBeenCalledWith('45 95% 62%');

		await view.rerender({ value: '45 95% 62%' } as never);
		expect(await screen.findByText('Yellow · the default')).toBeInTheDocument();
	});

	it("can't be opened while disabled", async () => {
		const user = userEvent.setup();
		mount(ColourField, {
			label: 'Colour for Claim',
			value: '45 95% 62%',
			swatches,
			disabled: true
		});

		await user.click(screen.getByRole('button', { name: /Colour for Claim/ }));
		expect(screen.queryByRole('radiogroup', anyVisibility)).not.toBeInTheDocument();
	});
});
