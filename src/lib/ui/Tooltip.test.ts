import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';

import TooltipHarness from './TooltipHarness.svelte';

/**
 * The gap this closes: every gate passed while the app would not start.
 *
 * bits-ui's Tooltip throws on mount without a Provider ancestor, and nothing in
 * the suite ever rendered one — so a missing provider at the app root took the
 * editor down and no test noticed. A component nobody mounts is a component
 * nobody is testing.
 */

describe('a tooltip-wrapped control', () => {
	it('mounts inside the provider the app supplies', () => {
		render(TooltipHarness, { props: { withProvider: true } });

		expect(screen.getByRole('button', { name: 'Insert a page break' })).toBeInTheDocument();
	});

	it('carries the label as the control accessible name', () => {
		// The tooltip is only visible on hover; a screen reader needs the name
		// whether or not it is on screen.
		render(TooltipHarness, { props: { withProvider: true } });

		expect(screen.getByLabelText('Insert a page break')).toBeInTheDocument();
	});

	it('makes the control itself the trigger, rather than wrapping it in one', () => {
		// A <button> inside a <button> is invalid HTML: the parser closes the outer
		// one early, so the trigger's listeners end up on an element that no longer
		// contains the control. The fix is delegation, and this is what pins it.
		render(TooltipHarness, { props: { withProvider: true } });

		const control = screen.getByRole('button', { name: 'Insert a page break' });

		expect(control.querySelector('button')).toBeNull();
		expect(control.parentElement?.closest('button')).toBeNull();
		// And the delegation actually happened — the control carries the trigger.
		expect(control).toHaveAttribute('data-tooltip-trigger');
	});

	it('fails loudly without a provider rather than at runtime in the app', () => {
		// Pinning the requirement: if bits-ui ever stops needing the provider this
		// test says so, and until then a missing one cannot reach a release.
		expect(() => render(TooltipHarness, { props: { withProvider: false } })).toThrow();
	});
});
