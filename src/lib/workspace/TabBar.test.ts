import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';

import TabBarHarness from './TabBarHarness.svelte';
import { workspaceStore } from './workspaceStore';
import { paneById, type Tab } from './tabs';

/**
 * The tab strip, mounted.
 *
 * A component nobody mounts is a component nobody is testing — which is how a
 * missing tooltip provider once took the whole editor down with every gate
 * green. Mounted through a harness carrying that provider, because the split
 * control is a tooltipped button and bits-ui throws without one; the app has
 * the provider at its root.
 *
 * This also holds a button inside a clickable row, and that arrangement has to
 * keep working: clicking close must not also switch to the tab being closed.
 */

const doc = (name: string): Tab => ({ id: `/p/${name}.erti.json`, kind: 'document', title: name });
const pdf = (name: string): Tab => ({ id: `/p/${name}.pdf`, kind: 'pdf', title: name });

function mount() {
	const workspace = get(workspaceStore);
	const pane = workspace.panes[0];

	return render(TabBarHarness, { props: { pane, workspace, focused: true } });
}

beforeEach(() => workspaceStore.reset());

describe('the tab strip', () => {
	it('mounts and announces itself as a tab list', () => {
		workspaceStore.open(doc('chapter-1'));

		mount();

		expect(screen.getByRole('tablist', { name: 'Open files' })).toBeInTheDocument();
	});

	it('shows a tab per open file, whatever kind', () => {
		// The point of the change: papers and manuscript in one row.
		workspaceStore.open(doc('chapter-1'));
		workspaceStore.open(pdf('smith-2020'));

		mount();

		expect(screen.getByRole('tab', { name: /chapter-1/ })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: /smith-2020/ })).toBeInTheDocument();
	});

	it('marks exactly one tab as selected', () => {
		workspaceStore.open(doc('chapter-1'));
		workspaceStore.open(pdf('smith-2020'));

		mount();

		const selected = screen.getAllByRole('tab').filter((t) => t.ariaSelected === 'true');
		expect(selected).toHaveLength(1);
		expect(selected[0]).toHaveTextContent('smith-2020');
	});

	it('keeps the strip to a single tab stop', () => {
		// Roving tabindex. Without it, reaching the manuscript past a dozen open
		// papers means a dozen presses of Tab.
		workspaceStore.open(doc('chapter-1'));
		workspaceStore.open(pdf('smith-2020'));

		mount();

		const stops = screen.getAllByRole('tab').filter((t) => t.getAttribute('tabindex') === '0');
		expect(stops).toHaveLength(1);
	});

	it('switches to a tab when it is clicked', async () => {
		const user = userEvent.setup();
		workspaceStore.open(doc('chapter-1'));
		workspaceStore.open(pdf('smith-2020'));
		mount();

		await user.click(screen.getByRole('tab', { name: /chapter-1/ }));

		const pane = paneById(get(workspaceStore), get(workspaceStore).focused)!;
		expect(pane.active).toBe(doc('chapter-1').id);
	});

	it('closes a tab without also selecting it', async () => {
		// The close control sits inside the clickable row, so its click has to stop
		// propagating — otherwise closing the tab on the left would first switch to
		// it, and the pane would end up showing something nobody asked for.
		const user = userEvent.setup();
		workspaceStore.open(doc('chapter-1'));
		workspaceStore.open(pdf('smith-2020'));
		mount();

		await user.click(screen.getByRole('button', { name: 'Close chapter-1' }));

		const pane = paneById(get(workspaceStore), get(workspaceStore).focused)!;
		expect(pane.tabs).not.toContain(doc('chapter-1').id);
		expect(pane.active).toBe(pdf('smith-2020').id);
	});

	it('gives every close control a name of its own', () => {
		// "button" twelve times over is not navigable by voice or screen reader.
		workspaceStore.open(doc('chapter-1'));
		workspaceStore.open(pdf('smith-2020'));

		mount();

		expect(screen.getByRole('button', { name: 'Close chapter-1' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Close smith-2020' })).toBeInTheDocument();
	});

	it('offers a split once there is something to split', async () => {
		const user = userEvent.setup();
		workspaceStore.open(pdf('smith-2020'));
		mount();

		await user.click(screen.getByRole('button', { name: 'Split the view' }));

		expect(get(workspaceStore).panes).toHaveLength(2);
	});

	it('offers no split when the pane is empty', () => {
		// Splitting nothing gives two empty panes and a narrower window.
		mount();

		expect(screen.queryByRole('button', { name: 'Split the view' })).not.toBeInTheDocument();
	});
});
