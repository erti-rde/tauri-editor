import { describe, expect, it } from 'vitest';

import type { SourceNote } from '$lib/stores/db';

import { notesInPageOrder } from './notesOrder';

const note = (id: string, page_label: string | null): SourceNote => ({
	id,
	sha256: 'erti:book',
	body: id,
	quote: null,
	page_label,
	label_id: null,
	created_at: '2026-10-05 12:00:00',
	updated_at: '2026-10-05 12:00:00'
});

describe('notesInPageOrder', () => {
	// M1b-8 AC-1
	it('puts notes on the whole work first, then front matter, then pages, then other labels', () => {
		const order = notesInPageOrder([
			note('p853', '853'),
			note('plate', 'Plate 3'),
			note('whole', null),
			note('p37', '37'),
			note('xiv', 'xiv'),
			note('ix', 'ix'),
			note('p37-38', '37–38'),
			note('blank', '  ')
		]).map((n) => n.id);

		expect(order).toEqual(['whole', 'blank', 'ix', 'xiv', 'p37', 'p37-38', 'p853', 'plate']);
	});

	it('keeps the order written for notes on the same page', () => {
		expect(notesInPageOrder([note('first', '12'), note('second', '12')]).map((n) => n.id)).toEqual([
			'first',
			'second'
		]);
	});
});
