import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import type { Annotation, SourceNote, WorkNotes } from '$lib/stores/db';
import UiHarness from '$lib/ui/UiHarness.svelte';

import SourceNotes from './SourceNotes.svelte';

const db = vi.hoisted(() => ({
	annotationLabels: vi.fn(),
	saveSourceNote: vi.fn(async () => {}),
	deleteSourceNote: vi.fn(async () => {}),
	embedSourceNote: vi.fn(async () => true)
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
	marks: [mark('m1', 3, 'Writing restructures consciousness.'), mark('m2', 9, 'Sound exists.')],
	files: [{ sha256: PDF, file_name: 'ong.pdf' }]
};

function show(notes: WorkNotes | null = NOTES, oncite?: (locator: string) => void) {
	const onchange = vi.fn(async () => {});
	render(UiHarness, { props: { component: SourceNotes, id: BOOK, notes, onchange, oncite } });
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
		show({ notes: [], marks: [], files: [] });
		expect(screen.getByText('No notes on this source yet.')).toBeInTheDocument();
		expect(screen.queryByRole('region', { name: 'Marked in the PDF' })).toBeNull();
	});

	// M1b-8 AC-2
	it('writes a new note, quote, page and label included, saved with ⌘↩', async () => {
		const user = userEvent.setup();
		const { onchange } = show({ notes: [], marks: [], files: [] });

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

		// M1b-8 AC-4: and then prepared for a search by meaning, the note just
		// kept and no other.
		const [saved] = db.saveSourceNote.mock.calls[0] as unknown as [{ id: string }];
		expect(db.embedSourceNote).toHaveBeenCalledWith(saved.id);
	});

	// M1b-8 AC-4
	it('keeps a note when it can’t be prepared for searching by meaning', async () => {
		const user = userEvent.setup();
		db.embedSourceNote.mockRejectedValueOnce(new Error('The model is still loading.'));
		const { onchange } = show({ notes: [], marks: [], files: [] });

		await user.click(screen.getByRole('button', { name: 'New note' }));
		const body = screen.getByRole('textbox', { name: /^Note/ });
		await waitFor(() => expect(body).toHaveFocus());
		await user.type(body, 'A thought');
		await user.keyboard('{Meta>}{Enter}{/Meta}');

		await waitFor(() => expect(db.embedSourceNote).toHaveBeenCalled());
		expect(onchange).toHaveBeenCalled();
		expect(toast.errorToast).not.toHaveBeenCalled();
	});

	// M1b-8 AC-2
	it('won’t save a note with nothing in it, and Escape leaves it', async () => {
		const user = userEvent.setup();
		show({ notes: [], marks: [], files: [] });

		await user.click(screen.getByRole('button', { name: 'New note' }));
		await user.click(screen.getByRole('button', { name: 'Save' }));
		expect(screen.getByText('Write a note, or the words you’re quoting.')).toBeInTheDocument();
		expect(db.saveSourceNote).not.toHaveBeenCalled();

		await user.type(screen.getByRole('textbox', { name: /^Note/ }), 'x{Escape}');
		expect(screen.queryByRole('form', { name: 'New note' })).toBeNull();
		expect(db.saveSourceNote).not.toHaveBeenCalled();
	});

	// Left to bubble, Escape reached the sidebar too, which closed on it.
	it('keeps its Escape to itself, so the sidebar around it stays open', async () => {
		const user = userEvent.setup();
		show({ notes: [], marks: [], files: [] });
		const seen: boolean[] = [];
		const listen = (e: KeyboardEvent) => e.key === 'Escape' && seen.push(e.defaultPrevented);
		document.addEventListener('keydown', listen);

		await user.click(screen.getByRole('button', { name: 'New note' }));
		await user.type(screen.getByRole('textbox', { name: /^Note/ }), '{Escape}');

		document.removeEventListener('keydown', listen);
		expect(seen).toEqual([true]);
	});

	it('offers no new note while one is being changed, which would drop the changes', async () => {
		const user = userEvent.setup();
		show();
		await screen.findByText('Claim');

		await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);

		expect(screen.queryByRole('button', { name: 'New note' })).toBeNull();
	});

	it('lists marks file by file, each named, when they’re on more than one', async () => {
		const preprint = 'a'.repeat(64);
		show({
			notes: [],
			marks: [
				{ ...mark('p1', 3, 'From the preprint.'), sha256: preprint },
				mark('s1', 3, 'From the scan.')
			],
			files: [
				{ sha256: preprint, file_name: 'ong-preprint.pdf' },
				{ sha256: PDF, file_name: 'ong.pdf' }
			]
		});
		await screen.findAllByText('Evidence');

		const region = screen.getByRole('region', { name: 'Marked in the PDF' });
		expect(within(region).getByText('ong-preprint.pdf')).toBeInTheDocument();
		expect(within(region).getByText('ong.pdf')).toBeInTheDocument();
	});

	it('says what an area mark is when its note was cleared', async () => {
		show({
			notes: [],
			marks: [{ ...mark('a1', 2, ''), kind: 'area', quote: null, note: '' }],
			files: [{ sha256: PDF, file_name: 'ong.pdf' }]
		});
		expect(await screen.findByText('An area of the page')).toBeInTheDocument();
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

	// M1b-8 AC-3
	it('offers Cite with p. N on a note with a page, which cites the work there', async () => {
		const user = userEvent.setup();
		const oncite = vi.fn();
		show(NOTES, oncite);
		await screen.findByText('Claim');

		const notes = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem');
		// Not on the note about the whole work, nor on a mark: those are cited elsewhere.
		expect(within(notes[0]).queryByRole('button', { name: /^Cite/ })).toBeNull();
		expect(
			within(screen.getByRole('region', { name: 'Marked in the PDF' })).queryByRole('button', {
				name: /^Cite/
			})
		).toBeNull();

		await user.click(within(notes[2]).getByRole('button', { name: 'Cite with p. 78' }));
		expect(oncite).toHaveBeenCalledWith('78');
		await user.click(within(notes[1]).getByRole('button', { name: 'Cite with p. 12' }));
		expect(oncite).toHaveBeenLastCalledWith('12');
	});

	// As the citation and the LaTeX export will print it: a range is pages.
	it('says pp. for a range of pages', async () => {
		show(
			{ ...NOTES, notes: [note({ id: 'r', body: 'A run of pages.', page_label: '80–82' })] },
			vi.fn()
		);

		expect(await screen.findByRole('button', { name: 'Cite with pp. 80–82' })).toBeInTheDocument();
	});

	// M1b-8 AC-3
	it('offers no citing with no manuscript to cite into', async () => {
		show();
		await screen.findByText('Claim');
		expect(screen.queryByRole('button', { name: /^Cite/ })).toBeNull();
	});
});
