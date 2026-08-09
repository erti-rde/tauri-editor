import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

/**
 * The appearance panel, mounted.
 *
 * It had never been rendered by a test — the same gap that let a missing
 * tooltip provider take the whole editor down while every gate stayed green.
 * The panel is also where the theme groups live, and those groups announced
 * themselves as radio groups while ignoring every arrow key.
 */

const update = vi.fn(async () => {});

vi.mock('$lib/theme/appearanceStore', async () => {
	const { writable } = await import('svelte/store');
	const { DEFAULT_APPEARANCE } = await import('$lib/theme/theme');

	return {
		appearanceStore: {
			subscribe: writable(DEFAULT_APPEARANCE).subscribe,
			update,
			initialise: vi.fn(),
			reset: vi.fn()
		}
	};
});

const { default: AppearanceSettings } = await import('./AppearanceSettings.svelte');

describe('the appearance panel', () => {
	it('mounts', () => {
		render(AppearanceSettings);

		expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
	});

	it('offers every palette as a radio, plus following the system', () => {
		render(AppearanceSettings);

		const themes = screen.getByRole('radiogroup', { name: 'Theme' });

		expect(screen.getByRole('radio', { name: /System/ })).toBeInTheDocument();
		// 7 palettes and the System option.
		expect(themes.querySelectorAll('[role="radio"]')).toHaveLength(8);
	});

	it('marks exactly one option as chosen', () => {
		render(AppearanceSettings);

		const chosen = screen
			.getByRole('radiogroup', { name: 'Theme' })
			.querySelectorAll('[aria-checked="true"]');

		expect(chosen).toHaveLength(1);
		expect(chosen[0]).toHaveTextContent('System');
	});

	it('moves between palettes with the arrow keys', async () => {
		// The behaviour the hand-rolled version claimed and did not have: it was
		// a div of buttons wearing radiogroup roles, with no tabindex and no key
		// handling at all.
		const user = userEvent.setup();
		render(AppearanceSettings);

		await user.tab();
		expect(screen.getByRole('radio', { name: /System/ })).toHaveFocus();

		await user.keyboard('{ArrowDown}');

		expect(screen.getByRole('radio', { name: /System/ })).not.toHaveFocus();
		expect(update).toHaveBeenCalled();
	});

	it('keeps the whole group to a single tab stop', async () => {
		// Roving tabindex. Without it, reaching Density means pressing Tab eight
		// times through the palettes.
		render(AppearanceSettings);

		const stops = screen
			.getByRole('radiogroup', { name: 'Theme' })
			.querySelectorAll('[role="radio"][tabindex="0"]');

		expect(stops).toHaveLength(1);
	});

	it('groups density and typeface too', () => {
		render(AppearanceSettings);

		expect(screen.getByRole('radiogroup', { name: 'Density' })).toBeInTheDocument();
		expect(screen.getByRole('radiogroup', { name: 'Manuscript typeface' })).toBeInTheDocument();
	});
});
