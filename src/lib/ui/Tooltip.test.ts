import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';

import TooltipHarness from './TooltipHarness.test.svelte';

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

	it('fails loudly without a provider rather than at runtime in the app', () => {
		// Pinning the requirement: if bits-ui ever stops needing the provider this
		// test says so, and until then a missing one cannot reach a release.
		expect(() => render(TooltipHarness, { props: { withProvider: false } })).toThrow();
	});
});
