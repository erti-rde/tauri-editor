import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import type { Annotation, SourceNote, WorkNotes } from '$lib/stores/db';
import UiHarness from '$lib/ui/UiHarness.svelte';

import SourceNotes from './SourceNotes.svelte';

const db = vi.hoisted(() => ({
	annotationLabels: vi.fn(),
	saveSourceNote: vi.fn(async () => {}),
	deleteSourceNote: vi.fn(async () => {})
}));
vi.mock('$lib/stores/db', () => db);
const toast = vi.hoisted(() => ({ errorToast: vi.fn() }));
vi.mock('$lib/toast/Toast.svelte', () => toast);

const BOOK = 'erti:6f1c3a52-8d0e-4c1b-9a7e-2b5d4f3e1a01';
const PDF = 'c'.repeat(64);

const LABELS = [
	{ id: 'claim', name: 'Claim', colour: '45 90% 60%', enabled: true, position: 0 },
	{ id: 'evidence', name: 'Evidence', colour: '140 50% 50%', enabled: true, position: 1 },
	{ id: 'old', name: 'Retired', colour: '0 0% 50%', enabled: false, position: 2 }
];

const note = (fields: Partial<SourceNote> & { id: string }): SourceNote => ({
	sha256: BOOK,
	body: '',
	quote: null,
	page_label: null,
	label_id: null,
	created_at: '2026-10-05 12:00:00',
	updated_at: '2026-10-05 12:00:00',
	...fields
});

const mark = (id: string, page: number, quote: string): Annotation =>
	({
		id,
		sha256: PDF,
		kind: 'highlight',
		label_id: 'evidence',
		page,
		rects: null,
		quote,
		prefix: null,
		suffix: null,
		char_start: null,
		char_end: null,
		note: null,
		style: 'fill',
		page_label: null,
		origin: 'erti',
		created_at: '2026-10-05 12:00:00',
		updated_at: '2026-10-05 12:00:00'
	}) as Annotation;

const NOTES: WorkNotes = {
	notes: [
		note({ id: 'p78', body: 'Literacy as technology.', page_label: '78', label_id: 'claim' }),
		note({ id: 'whole', body: 'The contrast I need for §3.\nAdditive, not subordinative.' }),
		note({ id: 'p12', quote: 'Primary orality: no knowledge of writing.', page_label: '12' })
	],
	marks: [mark('m1', 3, 'Writing restructures consciousness.'), mark('m2', 9, 'Sound exists.')]
};

function show(notes: WorkNotes | null = NOTES) {
	const onchange = vi.fn(async () => {});
	render(UiHarness, { props: { component: SourceNotes, id: BOOK, notes, onchange } });
	return { onchange };
}

/** The label list, from the keyboard: jsdom can't point at an option. */
async function chooseLabel(user: ReturnType<typeof userEvent.setup>, place: number) {
	const trigger = screen.getByRole('button', { name: 'Label' });
	trigger.focus();
	await user.keyboard('{Enter}');
	await screen.findByRole('listbox', { hidden: true });
	await user.keyboard('{Home}' + '{ArrowDown}'.repeat(place) + '{Enter}');
}

beforeEach(() => {
	vi.clearAllMocks();
	db.annotationLabels.mockResolvedValue(LABELS);
});

describe('the Notes tab (M1b-8, UX-3)', () => {
	// M1b-8 AC-1
	it('lists the source’s notes, then the marks on its files by page', async () => {
		show();
		await screen.findByText('Claim');

		const notes = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem');
		expect(notes.map((n) => n.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'The contrast I need for §3. Additive, not subordinative. Edit',
			'p. 12 Primary orality: no knowledge of writing. Edit',
			'Claim · p. 78 Literacy as technology. Edit'
		]);
		// The quote in the page's face, set apart from what was thought.
		expect(within(notes[1]).getByText(/Primary orality/)).toHaveClass('font-page');

		const marks = within(screen.getByRole('region', { name: 'Marked in the PDF' })).getAllByRole(
			'listitem'
		);
		expect(marks.map((m) => m.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Evidence · p. 3 Writing restructures consciousness.',
			'Evidence · p. 9 Sound exists.'
		]);
	});

	it('says when there’s nothing yet', () => {
		show({ notes: [], marks: [] });
		expect(screen.getByText('No notes on this source yet.')).toBeInTheDocument();
		expect(screen.queryByRole('region', { name: 'Marked in the PDF' })).toBeNull();
	});

	// M1b-8 AC-2
	it('writes a new note, quote, page and label included, saved with ⌘↩', async () => {
		const user = userEvent.setup();
		const { onchange } = show({ notes: [], marks: [] });

		await user.click(screen.getByRole('button', { name: 'New note' }));
		const body = screen.getByRole('textbox', { name: /^Note/ });
		await waitFor(() => expect(body).toHaveFocus());
		await user.type(body, 'Orality is *additive*.');
		await user.type(
			screen.getByRole('textbox', { name: /^Quote/ }),
			'Oral structures look to pragmatics.'
		);
		await user.type(screen.getByRole('textbox', { name: /^Page/ }), 'xiv');
		await chooseLabel(user, 2);
		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Label' })).toHaveTextContent('Evidence')
		);
		// The retired label isn't offered for a new note.
		expect(screen.queryByRole('option', { name: 'Retired', hidden: true })).toBeNull();

		screen.getByRole('textbox', { name: /^Page/ }).focus();
		await user.keyboard('{Meta>}{Enter}{/Meta}');

		await waitFor(() => expect(db.saveSourceNote).toHaveBeenCalledTimes(1));
		expect(db.saveSourceNote).toHaveBeenCalledWith({
			id: expect.stringMatching(/^[0-9a-f-]{36}$/),
			sha256: BOOK,
			body: 'Orality is *additive*.',
			quote: 'Oral structures look to pragmatics.',
			page_label: 'xiv',
			label_id: 'evidence'
		});
		expect(onchange).toHaveBeenCalled();
		expect(screen.queryByRole('form', { name: 'New note' })).toBeNull();
	});

	// M1b-8 AC-2
	it('won’t save a note with nothing in it, and Escape leaves it', async () => {
		const user = userEvent.setup();
		show({ notes: [], marks: [] });

		await user.click(screen.getByRole('button', { name: 'New note' }));
		await user.click(screen.getByRole('button', { name: 'Save' }));
		expect(screen.getByText('Write a note, or the words you’re quoting.')).toBeInTheDocument();
		expect(db.saveSourceNote).not.toHaveBeenCalled();

		await user.type(screen.getByRole('textbox', { name: /^Note/ }), 'x{Escape}');
		expect(screen.queryByRole('form', { name: 'New note' })).toBeNull();
		expect(db.saveSourceNote).not.toHaveBeenCalled();
	});

	// M1b-8 AC-2
	it('changes a note under its own id, and keeps the form open if saving fails', async () => {
		const user = userEvent.setup();
		show();
		db.saveSourceNote.mockRejectedValueOnce({ kind: 'NotFound', message: 'Gone.' });

		const p78 = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem')[2];
		await user.click(within(p78).getByRole('button', { name: 'Edit' }));
		const body = screen.getByRole('textbox', { name: /^Note/ });
		expect(body).toHaveValue('Literacy as technology.');
		await user.clear(body);
		await user.type(body, 'Writing as technology.');
		await user.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() => expect(toast.errorToast).toHaveBeenCalled());
		expect(screen.getByRole('form', { name: 'Change the note' })).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(db.saveSourceNote).toHaveBeenCalledTimes(2));
		expect(db.saveSourceNote).toHaveBeenLastCalledWith({
			id: 'p78',
			sha256: BOOK,
			body: 'Writing as technology.',
			quote: null,
			page_label: '78',
			label_id: 'claim'
		});
	});

	// M1b-8 AC-2
	it('deletes a note once asked', async () => {
		const user = userEvent.setup();
		const { onchange } = show();

		const whole = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem')[0];
		await user.click(within(whole).getByRole('button', { name: 'Edit' }));
		await user.click(screen.getByRole('button', { name: 'Delete' }));
		const dialog = await screen.findByRole('dialog', { name: 'Delete this note?' });
		await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

		await waitFor(() => expect(db.deleteSourceNote).toHaveBeenCalledWith('whole'));
		expect(onchange).toHaveBeenCalled();
	});
});
