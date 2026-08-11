import '@testing-library/jest-dom';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import Panel from './Panel.svelte';

// Mock the Icon component only
vi.mock('$lib', () => ({ Icon: () => '<svg></svg>' }));
// Do NOT mock Settings, let it render the real component
vi.mock('@tauri-apps/plugin-fs', () => ({
	readTextFile: vi.fn().mockResolvedValue('[]'),
	BaseDirectory: {}
}));
vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn().mockResolvedValue({ get: vi.fn().mockResolvedValue(undefined), set: vi.fn() })
}));
vi.mock('@tauri-apps/api/core');
vi.mock('@tauri-apps/api/path');
vi.mock('@tauri-apps/api/dialog');

/**
 * Located by name rather than by position.
 *
 * These read `getAllByRole('button')[2]`, so adding the outline button to the
 * rail moved every index and broke two tests that were about something else.
 * Naming the controls is also the fix for the underlying problem: they were
 * icon-only with no accessible name, and a screen reader announced four
 * buttons called "button".
 */
describe('Panel.svelte (with real Settings)', () => {
	it('calls toggleSidePanel with correct arguments', async () => {
		const toggleSidePanel = vi.fn();
		const { getByRole } = render(Panel, { props: { toggleSidePanel } });

		await fireEvent.click(getByRole('button', { name: 'Files' }));
		expect(toggleSidePanel).toHaveBeenCalledWith('fileExplorer');

		await fireEvent.click(getByRole('button', { name: 'Outline' }));
		expect(toggleSidePanel).toHaveBeenCalledWith('outline');

		await fireEvent.click(getByRole('button', { name: 'Sources' }));
		expect(toggleSidePanel).toHaveBeenCalledWith('metadataExplorer');
	});

	it('names every control in the rail', () => {
		// The gap this closes: four icon-only buttons, no labels, and a test that
		// could only tell them apart by counting.
		const { getAllByRole } = render(Panel, { props: { toggleSidePanel: vi.fn() } });

		for (const button of getAllByRole('button')) {
			expect(button).toHaveAccessibleName();
		}
	});

	it('toggles settings modal open/close and renders Settings', async () => {
		const toggleSidePanel = vi.fn();
		const { getByRole, queryByRole, findByRole } = render(Panel, {
			props: { toggleSidePanel }
		});
		const settingsButton = getByRole('button', { name: 'Settings' });
		// Initially closed
		expect(queryByRole('dialog')).not.toBeInTheDocument();
		// Open settings
		await fireEvent.click(settingsButton);
		const dialog = await findByRole('dialog');
		expect(dialog).toBeVisible();
		// Close settings (simulate close button inside Settings)
		const closeButton = getByRole('button', { name: /cancel/i });
		await fireEvent.click(closeButton);
		await waitFor(() => {
			expect(queryByRole('dialog')).not.toBeInTheDocument();
		});
	});
});
