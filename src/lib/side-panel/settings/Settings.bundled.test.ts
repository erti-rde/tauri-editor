import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readTextFile } from '@tauri-apps/plugin-fs';

import Settings from './Settings.svelte';

/**
 * Settings on a fresh install with network lookups declined: nothing stored, and
 * only the styles that ship with Erti available without asking (M0-3).
 */

vi.mock('$lib/stores/consent', () => ({
	getConsent: vi.fn().mockResolvedValue('declined'),
	getMailto: vi.fn().mockResolvedValue(''),
	setConsent: vi.fn().mockResolvedValue(undefined),
	setMailto: vi.fn().mockResolvedValue(undefined)
}));

const { stored, mockErrorToast } = vi.hoisted(() => ({
	stored: new Map<string, unknown>(),
	mockErrorToast: vi.fn()
}));

vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn().mockResolvedValue({
		get: vi.fn(async (key: string) => stored.get(key)),
		set: vi.fn(async (key: string, value: unknown) => void stored.set(key, value)),
		save: vi.fn()
	})
}));

vi.mock('$lib', () => ({ Icon: () => '<svg></svg>' }));
vi.mock('$lib/toast/Toast.svelte', () => ({ errorToast: mockErrorToast, successToast: vi.fn() }));

const MANIFEST = {
	default: { style: 'apa', locale: 'en-GB' },
	styles: [
		{ id: 'apa', name: 'APA Style 7th edition', label: 'APA 7th edition', file: 'styles/apa.csl' },
		{ id: 'ieee', name: 'IEEE Reference Guide', label: 'IEEE', file: 'styles/ieee.csl' }
	],
	locales: { 'en-GB': 'locales/locales-en-GB.xml', 'en-US': 'locales/locales-en-US.xml' }
};

vi.mock('@tauri-apps/plugin-fs', () => ({
	BaseDirectory: { Resource: 1 },
	readTextFile: vi.fn(async (path: string) => {
		if (path.endsWith('bundled.json')) return JSON.stringify(MANIFEST);
		if (path.endsWith('cslStyles.json')) {
			return JSON.stringify([
				// The online index also lists bundled styles; they must appear once.
				{ name: 'APA Style 7th edition', download_url: 'https://example.com/apa.csl' },
				{ name: 'Nature', download_url: 'https://example.com/nature.csl' }
			]);
		}
		if (path.endsWith('cslLocales.json')) {
			return JSON.stringify({
				'language-names': { 'en-GB': ['English (UK)'], 'de-DE': ['Deutsch'] }
			});
		}
		if (path.includes('/styles/')) return `<style id="${path}"/>`;
		if (path.includes('/locales/')) return `<locale id="${path}"/>`;
		return '{}';
	})
}));

global.dispatchEvent = vi.fn();
global.fetch = vi.fn();

async function openCitations() {
	render(Settings, { props: { isOpen: true, closeSettings: vi.fn() } });
	await fireEvent.click(screen.getByRole('tab', { name: 'Citations' }));
	await waitFor(() =>
		expect(screen.getByRole('group', { name: 'Included with Erti' })).toBeInTheDocument()
	);
}

beforeEach(() => {
	stored.clear();
	vi.clearAllMocks();
});

describe('Settings with the bundled styles (M0-3 AC-4)', () => {
	it('lists the included styles first, once, and shows the default as chosen', async () => {
		await openCitations();

		const included = screen.getByRole('group', { name: 'Included with Erti' });
		expect(
			within(included)
				.getAllByRole('option')
				.map((o) => o.textContent)
		).toEqual(['APA 7th edition', 'IEEE']);

		// APA is bundled, so it isn't offered a second time for download.
		const download = screen.getByRole('group', { name: 'Download (needs lookups on)' });
		expect(
			within(download)
				.getAllByRole('option')
				.map((o) => o.textContent)
		).toEqual(['Nature']);

		// A fresh install uses the bundled default, so that's what's selected.
		expect(screen.getByLabelText('Citation Style')).toHaveValue('APA Style 7th edition');
	});

	it('applies an included style and language without touching the network', async () => {
		await openCitations();

		await fireEvent.change(screen.getByLabelText('Citation Style'), {
			target: { value: 'IEEE Reference Guide' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() =>
			expect(stored.get('cslXml')).toBe('<style id="resources/csl/styles/ieee.csl"/>')
		);
		expect(stored.get('localeXml')).toBe('<locale id="resources/csl/locales/locales-en-GB.xml"/>');
		expect(global.fetch).not.toHaveBeenCalled();
		expect(mockErrorToast).not.toHaveBeenCalled();
		expect(readTextFile).toHaveBeenCalledWith('resources/csl/styles/ieee.csl', { baseDir: 1 });
	});
});

describe('downloads respect consent', () => {
	it('refuses to download a style while lookups are off, and says what to do', async () => {
		await openCitations();

		await fireEvent.change(screen.getByLabelText('Citation Style'), {
			target: { value: 'Nature' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() =>
			expect(mockErrorToast).toHaveBeenCalledWith(
				expect.stringContaining('"Nature" has to be downloaded, and lookups are off')
			)
		);
		expect(global.fetch).not.toHaveBeenCalled();
		// The choice is put back, so the dialog doesn't claim a style that isn't in use.
		expect(stored.get('cslXml')).toBeUndefined();
	});
});
