import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import AnnotationSidebar from './AnnotationSidebar.svelte';
import type { Annotation, AnnotationLabel } from '$lib/stores/db';

const labels: AnnotationLabel[] = [
	{ id: 'claim', name: 'Claim', colour: '45 95% 62%', position: 0, enabled: true },
	{ id: 'method', name: 'Method', colour: '210 80% 65%', position: 1, enabled: true },
	{ id: 'unused', name: 'Definition', colour: '185 55% 52%', position: 2, enabled: true }
];

function mark(overrides: Partial<Annotation> = {}): Annotation {
	return {
		id: 'a1',
		sha256: 'sha',
		kind: 'highlight',
		label_id: 'claim',
		page: 4,
		rects: '[]',
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

function mount(annotations: Annotation[], handlers: Record<string, unknown> = {}) {
	return render(AnnotationSidebar, {
		annotations,
		labels,
		onjump: vi.fn(),
		ondelete: vi.fn(),
		onnote: vi.fn(),
		onlabel: vi.fn(),
		...handlers
	});
}

describe('listing what is on a paper', () => {
	it('says how many marks there are', () => {
		mount([mark(), mark({ id: 'a2', page: 6 })]);

		expect(screen.getByText('2 marks')).toBeInTheDocument();
	});

	it('counts one mark in the singular', () => {
		mount([mark()]);

		expect(screen.getByText('1 mark')).toBeInTheDocument();
	});

	it('shows them in page order, because a paper is read front to back', () => {
		mount([
			mark({ id: 'late', page: 9, quote: 'later' }),
			mark({ id: 'early', page: 2, quote: 'earlier' })
		]);

		const quotes = screen
			.getAllByTitle('Show this passage in the paper')
			.map((b) => b.textContent?.trim());
		expect(quotes).toEqual(['earlier', 'later']);
	});

	it('orders two marks on one page by where they are, not by when they were made', () => {
		// The complaint this answers: marking a page's conclusion and then its
		// opening line listed them in that order, so the panel disagreed with the
		// paper it sits beside. PDF y grows upward, so 740 is above 120.
		const at = (y: number, quote: string, created: string) =>
			mark({
				id: quote,
				quote,
				page: 3,
				rects: JSON.stringify([{ x: 40, y, w: 200, h: 12 }]),
				created_at: created
			});

		mount([
			at(120, 'the conclusion', '2026-01-01T09:00:00Z'),
			at(740, 'the opening line', '2026-01-01T09:05:00Z')
		]);

		const quotes = screen
			.getAllByTitle('Show this passage in the paper')
			.map((b) => b.textContent?.trim());
		expect(quotes).toEqual(['the opening line', 'the conclusion']);
	});

	it('keeps a filter the reader chooses after a mark has been revealed', async () => {
		// The regression this pins: revealing read `filter`, so it re-ran whenever
		// the filter changed and cleared any choice that did not match the last
		// mark made. The filter row looked broken because it was.
		const user = userEvent.setup();
		const made = mark({ id: 'new', quote: 'a fresh method', label_id: 'method' });
		const other = mark({ id: 'old', quote: 'an older claim', label_id: 'claim' });

		mount([other, made], { reveal: 'new' });

		await user.click(screen.getByRole('button', { name: 'Claim' }));

		expect(screen.getByText('an older claim')).toBeInTheDocument();
		expect(screen.queryByText('a fresh method')).not.toBeInTheDocument();
	});

	it('reveals a new mark that the current filter would hide', async () => {
		// A mark that has just been made must be visible. Leaving it behind a
		// filter the reader set earlier reads as the highlight not having saved.
		const user = userEvent.setup();
		const existing = mark({ id: 'old', quote: 'an older claim', label_id: 'claim' });
		const made = mark({ id: 'new', quote: 'a fresh method', label_id: 'method' });

		const { rerender } = mount([existing, made]);
		await user.click(screen.getByRole('button', { name: 'Claim' }));
		expect(screen.queryByText('a fresh method')).not.toBeInTheDocument();

		await rerender({ reveal: 'new' });

		expect(await screen.findByText('a fresh method')).toBeInTheDocument();
	});

	it('invites a first highlight when there are none', () => {
		mount([]);

		expect(screen.getByText(/Nothing marked yet/)).toBeInTheDocument();
	});

	it('says when a mark came from another tool', () => {
		// So somebody else's reading is never mistaken for your own.
		mount([mark({ origin: 'imported' })]);

		expect(screen.getByTitle('Brought in from another tool')).toBeInTheDocument();
	});
});

describe('filtering', () => {
	it('offers only the labels this paper actually uses', () => {
		// A filter row listing every label in the app would mostly be dead buttons.
		mount([mark({ label_id: 'claim' })]);

		expect(screen.getByRole('button', { name: 'Claim' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Definition' })).not.toBeInTheDocument();
	});

	it('narrows to one label and back again', async () => {
		const user = userEvent.setup();
		mount([
			mark({ id: 'a1', quote: 'a claim' }),
			mark({ id: 'a2', label_id: 'method', quote: 'a method' })
		]);

		await user.click(screen.getByRole('button', { name: 'Claim' }));
		expect(screen.queryByText('a method')).not.toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'All' }));
		expect(screen.getByText('a method')).toBeInTheDocument();
	});

	it('says why the list is empty once the last mark of a filter is deleted', async () => {
		// The filter row only offers labels the paper actually uses, so an empty
		// filter cannot be chosen — it is arrived at by deleting the last mark
		// filed under the one currently selected.
		const user = userEvent.setup();
		const { rerender } = mount([mark({ id: 'a1' }), mark({ id: 'a2', label_id: 'method' })]);

		await user.click(screen.getByRole('button', { name: 'Method' }));
		await rerender({ annotations: [mark({ id: 'a1' })], labels });

		expect(screen.getByText(/No marks with that label/)).toBeInTheDocument();
	});
});

describe('acting on a mark', () => {
	it('jumps to the passage when its text is clicked', async () => {
		const user = userEvent.setup();
		const onjump = vi.fn();
		mount([mark()], { onjump });

		await user.click(screen.getByTitle('Show this passage in the paper'));

		expect(onjump).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
	});

	it('deletes one', async () => {
		const user = userEvent.setup();
		const ondelete = vi.fn();
		mount([mark()], { ondelete });

		await user.click(screen.getByRole('button', { name: 'Delete this mark' }));

		expect(ondelete).toHaveBeenCalledWith('a1');
	});

	it('refiles a mark under another label', async () => {
		const user = userEvent.setup();
		const onlabel = vi.fn();
		mount([mark()], { onlabel });

		await user.selectOptions(screen.getByLabelText('Label for this mark'), 'method');

		expect(onlabel).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), 'method');
	});

	it('can take a label away without deleting the mark', async () => {
		const user = userEvent.setup();
		const onlabel = vi.fn();
		mount([mark()], { onlabel });

		await user.selectOptions(screen.getByLabelText('Label for this mark'), '');

		expect(onlabel).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), null);
	});

	it('saves a note when the box loses focus', async () => {
		const user = userEvent.setup();
		const onnote = vi.fn();
		mount([mark()], { onnote });

		await user.click(screen.getByRole('button', { name: 'Write a note on this mark' }));
		await user.type(screen.getByRole('textbox'), 'this contradicts Smith');
		await user.tab();

		expect(onnote).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'a1' }),
			'this contradicts Smith'
		);
	});

	it('shows a note that is already there', () => {
		mount([mark({ note: 'check against Jones' })]);

		expect(screen.getByText('check against Jones')).toBeInTheDocument();
	});
});
