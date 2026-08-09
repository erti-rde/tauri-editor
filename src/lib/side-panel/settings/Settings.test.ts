import '@testing-library/jest-dom';
import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import Settings from './Settings.svelte';

// Consent persistence has its own module and its own store handle; stub it so
// this suite stays about the dialog rather than about plugin-store plumbing.
vi.mock('$lib/stores/consent', () => ({
	getConsent: vi.fn().mockResolvedValue('granted'),
	getMailto: vi.fn().mockResolvedValue(''),
	setConsent: vi.fn().mockResolvedValue(undefined),
	setMailto: vi.fn().mockResolvedValue(undefined)
}));

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
		it('renders all three tabs as tabs', async () => {
			render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });

			// role="tab", not role="button". Before the migration these were plain
			// buttons in a div, so a screen reader announced three unrelated
			// controls rather than a tab list, and arrow keys did nothing.
			expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
			expect(screen.getByRole('tab', { name: 'Citations' })).toBeInTheDocument();
			expect(screen.getByRole('tab', { name: 'Appearance' })).toBeInTheDocument();
			expect(screen.getByRole('tablist')).toBeInTheDocument();
		});

		it('marks the open tab as selected', async () => {
			render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });

			expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
			expect(screen.getByRole('tab', { name: 'Citations' })).toHaveAttribute(
				'aria-selected',
				'false'
			);
		});

		it('is announced as a dialog', async () => {
			// It was a div: no role, no aria-modal, so assistive technology had no
			// way to know a modal had opened or where it ended.
			render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });

			const dialog = screen.getByRole('dialog');
			expect(dialog).toBeInTheDocument();
			expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
		});

		// Test: Each tab shows the correct content when selected
		it('shows one panel at a time and switches on click', async () => {
			render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });

			// The panel is the tab's content now, so it is found through the role
			// rather than by reaching for a class that said whether it was hidden.
			expect(screen.getByRole('tabpanel')).toBeInTheDocument();
			expect(screen.getByText('General Settings')).toBeVisible();
			expect(screen.getByText('Word Count Target')).toBeVisible();

			await fireEvent.click(screen.getByRole('tab', { name: 'Citations' }));
			expect(screen.getByText('Citation Settings')).toBeVisible();
			expect(screen.getByText('Citation Style')).toBeVisible();
			// The other panel stays mounted but hidden, which is how Tabs keeps
			// scroll position and form state when you switch back.
			expect(screen.getByText('Word Count Target')).not.toBeVisible();

			await fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
			expect(screen.getByRole('heading', { name: 'Appearance' })).toBeVisible();
			expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
		});
	});

	describe('Interactions', () => {
		// Test: Clicking the close button calls the closeSettings function
		it('calls closeSettings when close button is clicked', async () => {
			const closeSettings = vi.fn();
			render(Settings, { props: { isOpen: true, closeSettings } });

			// Dialog.Close carries a real accessible name now. It had none before —
			// the icon is mocked in tests, so the control was nameless to a screen
			// reader too, and this test only found it because it was the only button
			// without one.
			const closeButton = screen.getByRole('button', { name: 'Close settings' });
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
