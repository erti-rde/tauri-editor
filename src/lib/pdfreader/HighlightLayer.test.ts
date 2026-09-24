import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import HighlightLayer from './HighlightLayer.svelte';
import type { Annotation, AnnotationLabel } from '$lib/stores/db';
import type { PageFrame } from './location';

/**
 * The marks drawn over the pages.
 *
 * A mark is the way back to the note written on it, so being able to reach one
 * is not decoration — clicking a highlight has to do something, and the handler
 * being present in this component says nothing about whether anything is
 * connected to it.
 */

const labels: AnnotationLabel[] = [
	{ id: 'claim', name: 'Claim', colour: '45 95% 62%', position: 0, enabled: true }
];

const frame: PageFrame = {
	page: 1,
	bounds: { left: 100, top: 200, width: 595, height: 800 },
	viewport: { transform: [1, 0, 0, -1, 0, 800] }
};

function mark(overrides: Partial<Annotation> = {}): Annotation {
	return {
		id: 'a1',
		sha256: 'sha',
		kind: 'highlight',
		label_id: 'claim',
		page: 1,
		rects: JSON.stringify([{ x: 10, y: 700, w: 200, h: 12 }]),
		quote: 'the effect was strongest',
		prefix: null,
		suffix: null,
		char_start: null,
		char_end: null,
		note: null,
		style: 'fill',
		page_label: null,
		origin: 'erti',
		created_at: '2026-01-01',
		updated_at: '2026-01-01',
		...overrides
	};
}

function mount(annotations: Annotation[], props: Record<string, unknown> = {}) {
	return render(HighlightLayer, {
		annotations,
		labels,
		frameFor: () => frame,
		revision: 0,
		flashing: null,
		...props
	});
}

describe('drawing the marks', () => {
	it('draws one for each rectangle of a mark', () => {
		mount([
			mark({
				rects: JSON.stringify([
					{ x: 10, y: 700, w: 200, h: 12 },
					{ x: 10, y: 680, w: 150, h: 12 }
				])
			})
		]);

		expect(screen.getAllByRole('button', { name: /^Claim:/ })).toHaveLength(2);
	});

	it('names a mark by its label, so it is reachable without sight', () => {
		mount([mark()]);

		expect(screen.getByRole('button', { name: /^Claim:/ })).toBeInTheDocument();
	});

	it('names an unlabelled mark something rather than nothing', () => {
		mount([mark({ label_id: null })]);

		expect(screen.getByRole('button', { name: /^Highlight:/ })).toBeInTheDocument();
	});

	it('positions it against the page it is on', () => {
		mount([mark()]);

		// PDF y grows upward: a 12-tall box at y=700 on an 800-tall page is 88
		// from the page's top, and the page itself is 200 down the content.
		const drawn = screen.getByRole('button', { name: /^Claim:/ });
		expect(drawn.style.left).toBe('110px');
		expect(drawn.style.top).toBe('288px');
	});

	it('leaves out a mark on a page that is not laid out yet', () => {
		mount([mark()], { frameFor: () => null });

		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('survives a mark whose anchor is malformed', () => {
		// One bad record should cost that mark, not the whole layer.
		mount([mark({ id: 'bad', rects: 'not json' }), mark({ id: 'good' })]);

		expect(screen.getAllByRole('button', { name: /^Claim:/ })).toHaveLength(1);
	});

	it('draws nothing for a page note, which has no rectangles', () => {
		mount([mark({ kind: 'page-note', rects: null })]);

		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});
});

describe('previewing a mark somewhere else', () => {
	it('draws it where the preview says', () => {
		mount([mark()], { override: { id: 'a1', rects: [{ x: 10, y: 700, w: 400, h: 12 }] } });

		expect((document.querySelector('.erti-mark') as HTMLElement).style.width).toBe('400px');
	});

	it('falls back to where it is stored when the preview is empty', () => {
		// An override is a preview, and an empty preview must never erase a mark.
		// The two came apart once — a mark put down while its save was in flight
		// kept its selection and lost its rectangles — and it simply vanished
		// until the reader clicked away from it.
		mount([mark()], { override: { id: 'a1', rects: [] } });

		expect(document.querySelector('.erti-mark')).not.toBeNull();
	});
});

describe('reaching a mark', () => {
	it('hands back the mark that was clicked', async () => {
		// This is the wiring that was missing: the layer offered `onselect` and
		// nothing in the reader was connected to it, so clicking a highlight did
		// nothing at all.
		const user = userEvent.setup();
		const onselect = vi.fn();
		mount([mark()], { onselect });

		await user.click(screen.getByRole('button', { name: /^Claim:/ }));

		expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
	});

	it('hands back the right one when several are drawn', async () => {
		const user = userEvent.setup();
		const onselect = vi.fn();
		mount([mark({ id: 'first' }), mark({ id: 'second', page: 1 })], { onselect });

		await user.click(screen.getAllByRole('button', { name: /^Claim:/ })[1]);

		expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: 'second' }));
	});

	it('does not fall over when nothing is listening', async () => {
		const user = userEvent.setup();
		mount([mark()]);

		await expect(
			user.click(screen.getByRole('button', { name: /^Claim:/ }))
		).resolves.not.toThrow();
	});
});

describe('how a mark is drawn', () => {
	it('fills the words by default', () => {
		mount([mark()]);

		const drawn = screen.getByRole('button', { name: /^Claim:/ });
		expect(drawn.className).not.toContain('erti-mark-underline');
	});

	it('underlines when that is the style', () => {
		mount([mark({ style: 'underline' })]);

		expect(screen.getByRole('button', { name: /^Claim:/ }).className).toContain(
			'erti-mark-underline'
		);
	});

	it('keeps an underline the full size of the passage', () => {
		// Drawn as a border on a full-height box rather than a two-pixel strip, so
		// the whole passage still takes the click.
		mount([mark({ style: 'underline' })]);

		expect(screen.getByRole('button', { name: /^Claim:/ }).style.height).toBe('12px');
	});
});
