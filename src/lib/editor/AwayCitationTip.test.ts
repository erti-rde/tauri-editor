import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

const { addSourceFromManuscript, successToast, store } = vi.hoisted(() => ({
	addSourceFromManuscript: vi.fn(async () => true),
	successToast: vi.fn(),
	store: {
		// Two ids of one work the project lacks: the book and its attached PDF.
		canonicalId: (id: string) => (id === 'pdf' ? 'erti:book' : id),
		isAway: (id: string) => id === 'pdf' || id === 'erti:book',
		getAllSourcesAsJson: () => ({
			'erti:book': { id: 'erti:book', type: 'book', title: 'A book from a co-author' }
		}),
		initializeCitationStore: vi.fn(async () => {})
	}
}));

vi.mock('$lib/stores/db', () => ({ addSourceFromManuscript }));
vi.mock('$lib/stores/citationStore', () => ({ citationStore: store }));
vi.mock('$lib/toast/Toast.svelte', () => ({ successToast, errorToast: vi.fn() }));
vi.mock('@floating-ui/dom', () => ({
	autoUpdate: () => () => {},
	computePosition: async () => ({ x: 0, y: 0 }),
	flip: () => ({}),
	offset: () => ({}),
	shift: () => ({})
}));

import AwayCitationTip from './AwayCitationTip.svelte';

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('AwayCitationTip', () => {
	// M1b-3: resolved by work, as the citation renders.
	it('adds a work once when the citation names two of its ids', async () => {
		const root = document.createElement('div');
		root.innerHTML = `<span data-type="citation" data-away data-id='["erti:book","pdf"]'>(Tanaka, 2021)</span>`;
		document.body.append(root);
		const view = render(AwayCitationTip, { props: { root, onadded: vi.fn() } });

		await fireEvent.mouseOver(root.querySelector('span')!);
		await fireEvent.click(await view.findByRole('button', { name: 'Add to library' }));

		await waitFor(() => expect(successToast).toHaveBeenCalledWith('Added to your library.'));
		expect(addSourceFromManuscript).toHaveBeenCalledTimes(1);
		expect(addSourceFromManuscript).toHaveBeenCalledWith(
			'erti:book',
			expect.stringContaining('A book from a co-author')
		);
		root.remove();
	});
});
