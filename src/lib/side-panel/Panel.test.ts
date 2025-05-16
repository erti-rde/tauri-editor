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

describe('Panel.svelte (with real Settings)', () => {
	it('calls toggleSidePanel with correct arguments', async () => {
		const toggleSidePanel = vi.fn();
		const { getAllByRole } = render(Panel, { props: { toggleSidePanel } });
		const buttons = getAllByRole('button');
		await fireEvent.click(buttons[0]);
		expect(toggleSidePanel).toHaveBeenCalledWith('fileExplorer');
		await fireEvent.click(buttons[1]);
		expect(toggleSidePanel).toHaveBeenCalledWith('metadataExplorer');
	});

	it('toggles settings modal open/close and renders Settings', async () => {
		const toggleSidePanel = vi.fn();
		const { getAllByRole, getByRole, queryByRole, findByRole } = render(Panel, {
			props: { toggleSidePanel }
		});
		const settingsButton = getAllByRole('button')[2];
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
