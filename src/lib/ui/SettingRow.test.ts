import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import SettingRowHarness from './SettingRowHarness.svelte';

/**
 * The Settings primitives (M5-10, docs/design-system.md): `SettingRow`, and
 * `RadioCard` in its group, which Library's restore and Appearance's palettes
 * are built from.
 */

describe('SettingRow', () => {
	it('M5-10: gives its control the label and hint as a name and description', () => {
		render(SettingRowHarness);
		const group = screen.getByRole('radiogroup', { name: 'Density' });
		expect(group).toHaveAccessibleDescription('How much fits on screen at once.');
		expect(screen.getByRole('button', { name: 'Move library…' })).toHaveAccessibleDescription(
			'Location ~/Erti/library.db'
		);
	});
});

describe('RadioCard', () => {
	it('M5-10: says which card is chosen in words as well as colour', () => {
		render(SettingRowHarness);
		const compact = screen.getByRole('radio', { name: /Compact/ });
		expect(compact).toHaveAttribute('aria-checked', 'true');
		expect(compact).toHaveAttribute('data-state', 'checked');
		expect(screen.getByRole('radio', { name: /Comfortable/ })).toHaveAttribute(
			'aria-checked',
			'false'
		);
		// The check is drawn on the chosen card only.
		expect(compact.querySelector('svg')).not.toBeNull();
		expect(screen.getByRole('radio', { name: /Comfortable/ }).querySelector('svg')).toBeNull();
	});

	it('M5-10: moves between cards with the arrow keys, past a disabled one', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		render(SettingRowHarness, { props: { onchange } });

		screen.getByRole('radio', { name: /Compact/ }).focus();
		await user.keyboard('{ArrowDown}');
		const comfortable = screen.getByRole('radio', { name: /Comfortable/ });
		expect(comfortable).toHaveFocus();
		expect(comfortable).toHaveAttribute('aria-checked', 'true');
		expect(onchange).toHaveBeenLastCalledWith('comfortable');

		await user.keyboard('{ArrowDown}');
		expect(screen.getByRole('radio', { name: /Compact/ })).toHaveFocus();
		expect(screen.getByRole('radio', { name: /Roomy/ })).toBeDisabled();
	});

	it('M5-10: is chosen with a click', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		render(SettingRowHarness, { props: { onchange } });
		await user.click(screen.getByRole('radio', { name: /Comfortable/ }));
		expect(onchange).toHaveBeenCalledExactlyOnceWith('comfortable');
	});
});
