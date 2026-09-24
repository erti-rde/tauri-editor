import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import Harness from './ReaderSidebarHarness.svelte';

/**
 * The panel a PDF reader has: the pages as pictures, the paper's own contents,
 * and what has been marked on it.
 */

/** jsdom has no IntersectionObserver, and the thumbnails are drawn on sight. */
const seen: ((entries: { isIntersecting: boolean }[]) => void)[] = [];

beforeEach(() => {
	seen.length = 0;
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
				seen.push(callback);
			}
			observe() {}
			disconnect() {}
		}
	);
});

/** Scroll every observed frame into view. */
function scrollIntoSight() {
	for (const callback of [...seen]) callback([{ isIntersecting: true }]);
}

function mount(props: Record<string, unknown> = {}) {
	return render(Harness, {
		tab: 'thumbnails',
		ontab: vi.fn(),
		pages: 3,
		page: 1,
		pageLabels: null,
		outline: [],
		thumbnail: vi.fn(async () => 'data:image/png;base64,AAA'),
		revision: 0,
		onpage: vi.fn(),
		onoutline: vi.fn(),
		annotations: [],
		labels: [],
		reveal: null,
		onjump: vi.fn(),
		ondelete: vi.fn(),
		onnote: vi.fn(),
		onlabel: vi.fn(),
		...props
	});
}

describe('the pages', () => {
	it('offers one frame per sheet, whether or not it has been drawn', () => {
		mount({ pages: 3 });

		expect(screen.getByRole('button', { name: 'Go to page 1' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Go to page 3' })).toBeInTheDocument();
	});

	it('names them as the paper does, when the paper says', () => {
		// A journal offprint beginning on page 843 calls its first sheet 843, and
		// that is the number the reader is looking for.
		mount({ pages: 2, pageLabels: ['843', '844'] });

		expect(screen.getByRole('button', { name: 'Go to page 843' })).toBeInTheDocument();
	});

	it('draws a page only once it comes into view', async () => {
		// A three-hundred-page thesis cannot render every page to open a panel.
		const thumbnail = vi.fn(async () => 'data:image/png;base64,AAA');
		mount({ pages: 3, thumbnail });

		expect(thumbnail).not.toHaveBeenCalled();

		scrollIntoSight();
		await vi.waitFor(() => expect(thumbnail).toHaveBeenCalled());
	});

	it('turns the page when one is chosen', async () => {
		const user = userEvent.setup();
		const onpage = vi.fn();
		mount({ pages: 3, onpage });

		await user.click(screen.getByRole('button', { name: 'Go to page 2' }));

		expect(onpage).toHaveBeenCalledWith(2);
	});

	it('says which one is on screen', () => {
		mount({ pages: 3, page: 2 });

		expect(screen.getByRole('button', { name: 'Go to page 2' })).toHaveAttribute(
			'aria-current',
			'page'
		);
	});
});

describe('the contents', () => {
	const outline = [
		{ title: 'Introduction', dest: 'd1', children: [] },
		{
			title: 'Method',
			dest: 'd2',
			children: [{ title: 'Participants', dest: 'd3', children: [] }]
		}
	];

	it('lists the headings the paper carries, nested', () => {
		mount({ tab: 'contents', outline });

		expect(screen.getByRole('button', { name: 'Introduction' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Participants' })).toBeInTheDocument();
	});

	it('follows one', async () => {
		const user = userEvent.setup();
		const onoutline = vi.fn();
		mount({ tab: 'contents', outline, onoutline });

		await user.click(screen.getByRole('button', { name: 'Participants' }));

		expect(onoutline).toHaveBeenCalledWith('d3');
	});

	it('says so plainly when the paper carries none', () => {
		// Most scans do not. An empty panel would read as a fault.
		mount({ tab: 'contents', outline: [] });

		expect(screen.getByText(/carries no table of contents/)).toBeInTheDocument();
	});
});

describe('choosing what to show', () => {
	it('offers all three', () => {
		mount();

		expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Contents' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Marks' })).toBeInTheDocument();
	});

	it('says which is showing', () => {
		mount({ tab: 'contents' });

		expect(screen.getByRole('tab', { name: 'Contents' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'false');
	});
});
