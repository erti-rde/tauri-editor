import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import ReadingSettings from './ReadingSettings.svelte';
import UiHarness from '$lib/ui/UiHarness.svelte';
import { followSetting, nudgeSetting } from '$lib/notes/writingSettings';

/**
 * Settings › Reading: the two switches that decide whether the reading reaches
 * into the writing (M3-4), above the highlight labels.
 */

const file = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn(async () => ({
		get: async (key: string) => file.get(key),
		set: async (key: string, value: unknown) => void file.set(key, value),
		delete: async (key: string) => file.delete(key),
		save: async () => {}
	}))
}));

const LABEL = { id: 'l1', name: 'Method', colour: '50 90% 60%', enabled: true, position: 0 };
vi.mock('$lib/stores/db', () => ({
	annotationLabels: vi.fn(async () => [LABEL]),
	saveLabel: vi.fn(async () => {}),
	deleteLabel: vi.fn(async () => {}),
	restoreDefaultLabels: vi.fn(async () => 0),
	nameLabelsAfterColours: vi.fn(async () => 0)
}));

/**
 * Settings opened, inside the tooltip provider the app's root supplies.
 * Reading them back after a restart is writingSettings.test.ts.
 */
async function open() {
	return render(UiHarness, { props: { component: ReadingSettings } });
}

beforeEach(async () => {
	await Promise.all([followSetting.setEnabled(true), nudgeSetting.setEnabled(true)]);
	file.clear();
});

describe('Settings › Reading', () => {
	// M3-4 AC-1
	it('has Follow my writing and Margin nudge, both on by default', async () => {
		await open();

		expect(await screen.findByRole('switch', { name: 'Follow my writing' })).toBeChecked();
		expect(screen.getByRole('switch', { name: 'Margin nudge' })).toBeChecked();
	});

	// M3-4 AC-1: persisted.
	it('remembers each switch turned off, apart from the other', async () => {
		const user = userEvent.setup();
		const first = await open();

		await user.click(await screen.findByRole('switch', { name: 'Margin nudge' }));
		await waitFor(() => expect(file.get('noteNudges')).toBe(false));
		expect(file.has('followWriting')).toBe(false);
		first.unmount();

		// Opened again: as it was left.
		await open();
		expect(await screen.findByRole('switch', { name: 'Margin nudge' })).not.toBeChecked();
		expect(screen.getByRole('switch', { name: 'Follow my writing' })).toBeChecked();

		await user.click(screen.getByRole('switch', { name: 'Follow my writing' }));
		await waitFor(() => expect(file.get('followWriting')).toBe(false));
	});

	it('still lists the labels, each with a switch to show it', async () => {
		await open();

		expect(await screen.findByRole('textbox', { name: 'Name for this label' })).toHaveValue(
			'Method'
		);
		expect(screen.getByRole('switch', { name: 'Show' })).toBeChecked();
		expect(screen.getByRole('button', { name: 'Remove the label Method' })).toBeInTheDocument();
	});
});
