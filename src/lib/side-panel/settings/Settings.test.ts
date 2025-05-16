import '@testing-library/jest-dom';
import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import Settings from './Settings.svelte';

const { mockStore } = vi.hoisted(() => {
	return {
		mockStore: {
			get: vi.fn((key) => {
				switch (key) {
					case 'wordCount':
						return Promise.resolve(500);
					case 'selectedStyle':
						return Promise.resolve('APA');
					case 'selectedLocale':
						return Promise.resolve('en-US');
					case 'cslXml':
						return Promise.resolve('<xml>Test XML Content</xml>');
					case 'localeXml':
						return Promise.resolve('<xml>Test Locale XML Content</xml>');
					default:
						return Promise.resolve(null);
				}
			}),
			set: vi.fn().mockResolvedValue(undefined)
		}
	};
});

vi.mock('@tauri-apps/plugin-store', () => {
	// Create a mock store object that we can reference throughout our tests
	return {
		load: vi.fn().mockResolvedValue(mockStore)
	};
});

// Mock required dependencies
vi.mock('$lib', () => ({ Icon: () => '<svg></svg>' }));

// Mock window.dispatchEvent
global.dispatchEvent = vi.fn();
global.fetch = vi.fn().mockImplementation(() =>
	Promise.resolve({
		ok: true,
		text: () => Promise.resolve('<xml>Test XML Content</xml>')
	})
);

// Mock Tauri plugin-fs
vi.mock('@tauri-apps/plugin-fs', () => ({
	readTextFile: vi.fn((filePath) => {
		// Return different mock data based on the file path
		if (filePath.includes('cslStyles.json')) {
			return Promise.resolve(
				JSON.stringify([
					{ name: 'APA', download_url: 'https://example.com/apa.csl' },
					{ name: 'Chicago', download_url: 'https://example.com/chicago.csl' },
					{ name: 'MLA', download_url: 'https://example.com/mla.csl' }
				])
			);
		} else if (filePath.includes('cslLocales.json')) {
			return Promise.resolve(
				JSON.stringify({
					'primary-dialects': {
						en: 'en-US',
						fr: 'fr-FR',
						de: 'de-DE'
					},
					'language-names': {
						'en-US': ['English (US)'],
						'en-GB': ['English (UK)'],
						'fr-FR': ['Français'],
						'de-DE': ['Deutsch']
					}
				})
			);
		}
		return Promise.resolve('{}');
	}),
	BaseDirectory: { Resource: 1 }
}));

describe('Settings.svelte', () => {
	// 1. Rendering Tests
	describe('Rendering', () => {
		// Test: Component renders correctly when isOpen is true
		it('renders when isOpen is true', async () => {
			render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });
			expect(screen.getByRole('dialog')).toBeInTheDocument();
			expect(screen.getByText('Settings')).toBeInTheDocument();
		});

		// Test: Component does not render when isOpen is false
		it('does not render when isOpen is false', async () => {
			render(Settings, { props: { isOpen: false, closeSettings: vi.fn() } });
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		});

		// Test: All tabs render correctly
		it('renders all three tabs correctly', async () => {
			render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });
			expect(screen.getByText('General')).toBeInTheDocument();
			expect(screen.getByText('Citations')).toBeInTheDocument();
			expect(screen.getByText('Appearance')).toBeInTheDocument();
		});

		// Test: Each tab shows the correct content when selected
		it('shows correct content for each tab', async () => {
			render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });
			// Default tab should be "general"
			expect(screen.getByText('General Settings')).toBeVisible();

			// Check that Word Count Target is visible in the general tab
			const wordCountElement = screen.getByText('Word Count Target');
			expect(wordCountElement).toBeVisible();
			// The parent div should have a class that includes 'block' (visible)
			const parentPanel = wordCountElement.closest('div[class*="absolute inset-0"]');
			expect(parentPanel).not.toBeNull();
			expect(parentPanel).toBeVisible();

			// Find the Citations tab content - it should be in the DOM but hidden
			const citationSettingsHeading = screen.getByText('Citation Settings');
			const citationsPanel = citationSettingsHeading.closest('div[class*="absolute inset-0"]');
			expect(citationsPanel).not.toBeNull();
			expect(citationsPanel).toHaveClass('hidden');

			// Switch to Citations tab
			await fireEvent.click(screen.getByText('Citations'));
			expect(citationSettingsHeading).toBeVisible();
			expect(screen.getByText('Citation Style')).toBeVisible();
			expect(screen.getByText('Citation Language')).toBeVisible();

			// General tab should now be hidden
			expect(parentPanel).toHaveClass('hidden');

			// Switch to Appearance tab
			await fireEvent.click(screen.getByText('Appearance'));
			expect(screen.getByText('Appearance Settings')).toBeVisible();
			expect(
				screen.getByText('Appearance settings will be available in a future update.')
			).toBeVisible();

			// Citations tab should now be hidden
			expect(citationsPanel).toHaveClass('hidden');
		});
	});

	describe('Interactions', () => {
		// Test: Clicking the close button calls the closeSettings function
		it('calls closeSettings when close button is clicked', async () => {
			const closeSettings = vi.fn();
			render(Settings, { props: { isOpen: true, closeSettings } });

			const closeButton = screen.getByRole('button', { name: '' }); // Since we mocked the icon, it has no name
			await fireEvent.click(closeButton);

			expect(closeSettings).toHaveBeenCalledTimes(1);
		});

		// Test: Clicking Cancel button calls the closeSettings function
		it('calls closeSettings when Cancel button is clicked', async () => {
			const closeSettings = vi.fn();
			render(Settings, { props: { isOpen: true, closeSettings } });

			const cancelButton = screen.getByRole('button', { name: 'Cancel' });
			await fireEvent.click(cancelButton);

			expect(closeSettings).toHaveBeenCalledTimes(1);
		});

		// Test: Clicking Save button calls the saveSettings function and emits settings-updated event
		it('calls internal saveSettings when Save button is clicked', async () => {
			const closeSettings = vi.fn();
			render(Settings, { props: { isOpen: true, closeSettings } });

			// Wait for component to initialize
			await waitFor(() => {
				expect(screen.getByText('Word Count Target')).toBeInTheDocument();
			});

			// Click the save button
			const saveButton = screen.getByRole('button', { name: 'Save changes' });
			await fireEvent.click(saveButton);

			// Check if the settings-updated event was dispatched
			await waitFor(() => {
				expect(global.dispatchEvent).toHaveBeenCalled();

				// Check that the event is of the correct type
				expect(global.dispatchEvent).toHaveBeenCalledWith(
					expect.objectContaining({
						type: 'settings-updated',
						detail: expect.objectContaining({
							wordCountHasChanged: expect.any(Boolean),
							styleHasChanged: expect.any(Boolean),
							localeHasChanged: expect.any(Boolean)
						})
					})
				);
			});

			// Also verify that closeSettings was called
			expect(closeSettings).toHaveBeenCalled();
		});
	});
});
