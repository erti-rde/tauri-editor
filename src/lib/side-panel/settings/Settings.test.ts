import '@testing-library/jest-dom';
import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import Settings from './Settings.svelte';
import { getConsent, setConsent } from '$lib/stores/consent';
import { readTextFile } from '@tauri-apps/plugin-fs';

// Consent persistence has its own module and its own store handle; stub it so
// this suite stays about the dialog rather than about plugin-store plumbing.
vi.mock('$lib/stores/consent', () => ({
	getConsent: vi.fn().mockResolvedValue('granted'),
	getMailto: vi.fn().mockResolvedValue(''),
	setConsent: vi.fn().mockResolvedValue(undefined),
	setMailto: vi.fn().mockResolvedValue(undefined)
}));

const { mockStore, mockErrorToast } = vi.hoisted(() => {
	return {
		mockErrorToast: vi.fn(),
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
			set: vi.fn().mockResolvedValue(undefined),
			// Every write is saved now (M1a-11), where the panel used to leave that
			// to whichever write happened to save last.
			save: vi.fn().mockResolvedValue(undefined)
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
vi.mock('$lib/ui/Toast.svelte', () => ({
	errorToast: mockErrorToast,
	successToast: vi.fn()
}));

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
			expect(screen.getByRole('heading', { name: 'General' })).toBeVisible();
			expect(screen.getByText('Word-count target')).toBeVisible();

			await fireEvent.click(screen.getByRole('tab', { name: 'Citations' }));
			expect(screen.getByRole('heading', { name: 'Citations' })).toBeVisible();
			expect(screen.getByText('Citation style')).toBeVisible();
			// The other panel stays mounted but hidden, which is how Tabs keeps
			// scroll position and form state when you switch back.
			expect(screen.getByText('Word-count target')).not.toBeVisible();

			await fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
			expect(screen.getByRole('heading', { name: 'Appearance' })).toBeVisible();
			expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
		});

		it('M6-8 AC-1: each setting is its primitive, named by its label', async () => {
			render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });

			expect(await screen.findByRole('spinbutton', { name: 'Word-count target' })).toHaveAttribute(
				'aria-valuetext',
				expect.stringMatching(/ words$/)
			);
			// Waits for Save like the rest of the tab, so a checkbox, not a switch.
			expect(
				screen.getByRole('checkbox', { name: /Look up citation details online/ })
			).toHaveAccessibleDescription(/doi\.org and crossref\.org/);

			await fireEvent.click(screen.getByRole('tab', { name: 'Citations' }));
			// Applied at once by its store, so a switch.
			expect(
				screen.getByRole('switch', { name: 'Add a reference list automatically' })
			).toBeVisible();
			expect(screen.getByRole('combobox', { name: 'Citation style' })).toHaveAccessibleDescription(
				/available|match/
			);
			expect(screen.getByRole('searchbox', { name: 'Filter citation styles' })).toBeVisible();
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
				expect(screen.getByText('Word-count target')).toBeInTheDocument();
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

		// Test: a style whose URL has gone stale upstream is reported, not swallowed
		it('surfaces a 404 from the style repository instead of failing silently', async () => {
			const closeSettings = vi.fn();
			render(Settings, { props: { isOpen: true, closeSettings } });
			await fireEvent.click(screen.getByRole('tab', { name: 'Citations' }));

			await waitFor(() => {
				expect(screen.getByRole('option', { name: 'Chicago' })).toBeInTheDocument();
			});

			// Picking a different style is what triggers the download.
			await fireEvent.change(screen.getByLabelText('Citation style'), {
				target: { value: 'Chicago' }
			});
			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: false,
				status: 404
			} as Response);

			await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

			await waitFor(() => {
				expect(mockErrorToast).toHaveBeenCalledWith(
					expect.stringContaining('no longer published by the CSL style repository')
				);
			});
			// The dialog stays open so the user can pick a style that works.
			expect(closeSettings).not.toHaveBeenCalled();
			expect(mockStore.set).toHaveBeenCalledWith('selectedStyle', 'APA');
		});

		// Settings is mounted from launch, closed, so on a first launch it mounts
		// before the consent question is answered. Found by the real-app capture.
		it('M6-4 AC-1: takes consent given after it mounted, rather than refusing downloads and saving it as declined', async () => {
			vi.mocked(getConsent).mockResolvedValue('unasked');
			vi.mocked(readTextFile).mockClear();
			const closeSettings = vi.fn();
			const { rerender } = render(Settings, { props: { isOpen: false, closeSettings } });
			// Mounted, closed, while the question is still unanswered.
			// Mount reads the style lists last.
			await waitFor(() =>
				expect(readTextFile).toHaveBeenCalledWith(
					expect.stringContaining('cslStyles.json'),
					expect.anything()
				)
			);

			// "Allow lookups", answered at the prompt; then Settings is opened.
			vi.mocked(getConsent).mockResolvedValue('granted');
			vi.mocked(global.fetch).mockClear();
			vi.mocked(setConsent).mockClear();
			await rerender({ isOpen: true, closeSettings });
			await fireEvent.click(screen.getByRole('tab', { name: 'Citations' }));
			await waitFor(() => {
				expect(screen.getByRole('option', { name: 'Chicago' })).toBeInTheDocument();
			});
			await fireEvent.change(screen.getByLabelText('Citation style'), {
				target: { value: 'Chicago' }
			});
			await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

			await waitFor(() => expect(closeSettings).toHaveBeenCalled());
			expect(global.fetch).toHaveBeenCalledWith('https://example.com/chicago.csl');
			expect(setConsent).toHaveBeenCalledWith(true);
			expect(setConsent).not.toHaveBeenCalledWith(false);
		});

		it('M6-4 AC-1: holds Save until consent has been read, so it cannot write "declined" unseen', async () => {
			let answer: (consent: 'granted') => void = () => {};
			vi.mocked(getConsent).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
			vi.mocked(setConsent).mockClear();
			render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });

			const save = screen.getByRole('button', { name: 'Save changes' });
			expect(save).toBeDisabled();
			await fireEvent.click(save);
			expect(setConsent).not.toHaveBeenCalled();

			answer('granted');
			await waitFor(() => expect(save).toBeEnabled());
			await fireEvent.click(save);
			await waitFor(() => expect(setConsent).toHaveBeenCalledWith(true));
		});

		it('M6-4 AC-1: holds the lookups checkbox until consent has been read, so a late read cannot undo a change', async () => {
			let answer: (consent: 'granted') => void = () => {};
			vi.mocked(getConsent).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
			render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });

			const lookups = screen.getByRole('checkbox', { name: /Look up citation details online/ });
			expect(lookups).toBeDisabled();

			answer('granted');
			await waitFor(() => expect(lookups).toBeEnabled());
			expect(lookups).toBeChecked();
		});

		it('M6-4 AC-1: ignores a consent read from an earlier opening that answers late', async () => {
			let first: (consent: 'unasked') => void = () => {};
			let second: (consent: 'granted') => void = () => {};
			vi.mocked(getConsent)
				.mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
				.mockReturnValueOnce(new Promise((resolve) => (second = resolve)));
			vi.mocked(setConsent).mockClear();
			const closeSettings = vi.fn();
			const { rerender } = render(Settings, { props: { isOpen: true, closeSettings } });
			// Closed and opened again, "Allow lookups" answered in between, before
			// the first read came back.
			await rerender({ isOpen: false, closeSettings });
			await rerender({ isOpen: true, closeSettings });

			first('unasked');
			const save = screen.getByRole('button', { name: 'Save changes' });
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(save).toBeDisabled();

			second('granted');
			await waitFor(() => expect(save).toBeEnabled());
			await fireEvent.click(save);
			await waitFor(() => expect(setConsent).toHaveBeenCalledWith(true));
			expect(setConsent).not.toHaveBeenCalledWith(false);
		});

		// Test: the style list can be narrowed down
		it('filters the style list while keeping the current selection selectable', async () => {
			render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });
			await fireEvent.click(screen.getByRole('tab', { name: 'Citations' }));

			await waitFor(() => {
				expect(screen.getByRole('option', { name: 'Chicago' })).toBeInTheDocument();
			});

			await fireEvent.input(screen.getByLabelText('Filter citation styles'), {
				target: { value: 'ml' }
			});

			expect(screen.getByRole('option', { name: 'MLA' })).toBeInTheDocument();
			expect(screen.queryByRole('option', { name: 'Chicago' })).not.toBeInTheDocument();
			// APA does not match the query but is the saved selection, so it stays.
			expect(screen.getByRole('option', { name: 'APA' })).toBeInTheDocument();
			// ...but it is not counted as a match: only MLA matches "ml".
			expect(screen.getByText(/1 of 3 styles match/)).toBeInTheDocument();
		});
	});
});
