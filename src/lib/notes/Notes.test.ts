import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import Notes from './Notes.svelte';
import { draftContext, draftMatches } from './draftContext';
import { showInPdf } from '$lib/pdfreader/showInPdf';

/**
 * The panel that answers "where did I write something about this idea".
 *
 * These are about what it says when it has nothing to show. A search that
 * failed and a search that found nothing used to look identical — an empty
 * panel — which is why "search by meaning does nothing" was a fair description
 * of it.
 */

const db = vi.hoisted(() => ({
	// Typed loosely on purpose: the mocks stand in for commands whose real
	// return types come from Rust, and pinning them here would only restate the
	// wrappers.
	allAnnotations: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
	allSourceNotes: vi.fn<() => Promise<unknown[]>>(async () => []),
	searchNotes: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
	embedPendingAnnotations: vi.fn<() => Promise<number>>(async () => 0),
	projectSources: vi.fn<() => Promise<unknown[]>>(async () => []),
	sourceAliases: vi.fn<() => Promise<Record<string, string>>>(async () => ({})),
	annotationLabels: vi.fn<() => Promise<unknown[]>>(async () => [])
}));
vi.mock('$lib/stores/db', () => db);

const files = vi.hoisted(() => ({
	save: vi.fn<() => Promise<string | null>>(async () => null),
	writeTextFile: vi.fn<(path: string, contents: string) => Promise<void>>(async () => {})
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: files.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: files.writeTextFile }));
vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn(async () => ({ get: vi.fn(async () => undefined), set: vi.fn(), save: vi.fn() }))
}));
vi.mock('$lib/pdfreader/showInPdf', () => ({ showInPdf: vi.fn(async () => true) }));

const MARK = {
	id: 'a1',
	sha256: 'sha-1',
	kind: 'highlight' as const,
	label_id: null,
	page: 4,
	rects: '[]',
	quote: 'the effect was strongest',
	prefix: null,
	suffix: null,
	char_start: null,
	char_end: null,
	note: null,
	style: 'fill' as const,
	page_label: null,
	origin: 'erti' as const,
	created_at: '2026-01-01',
	updated_at: '2026-01-01',
	similarity: 0.8,
	source_id: 'sha-1',
	in_project: true,
	file_name: 'paper.pdf'
};
/** A mark as a search returns it: saying which kind of note it is. */
const hit = (mark: typeof MARK) => ({ kind: 'annotation', hit: mark });

const SOURCE_NOTE = {
	id: 'n1',
	sha256: 'erti:ong',
	body: 'Additive rather than subordinative.',
	quote: 'Oral structures look to pragmatics.',
	page_label: '37',
	label_id: null,
	created_at: '2026-01-02',
	updated_at: '2026-01-02',
	similarity: 0.7,
	source_id: 'erti:ong',
	in_project: true,
	title: 'Orality and Literacy'
};
const noteHit = (note: typeof SOURCE_NOTE) => ({ kind: 'source_note', hit: note });

beforeEach(() => {
	vi.clearAllMocks();
	db.allAnnotations.mockResolvedValue([]);
	db.allSourceNotes.mockResolvedValue([]);
	db.searchNotes.mockResolvedValue([]);
	db.annotationLabels.mockResolvedValue([]);
});

async function ask(user: ReturnType<typeof userEvent.setup>, words: string) {
	await user.type(screen.getByLabelText('Search your notes'), words);
	await user.click(screen.getByRole('radio', { name: 'Meaning' }));
}

describe('when there is nothing to show', () => {
	it('says a search failed rather than going blank', async () => {
		const user = userEvent.setup();
		// Only the typed search fails: browsing on mount succeeds, so what's on
		// screen afterwards is the search's own failure.
		db.searchNotes.mockImplementation(async (query) => {
			if (query === 'attention') throw new Error('no library is open');
			return [];
		});

		render(Notes);
		await waitFor(() => expect(db.searchNotes).toHaveBeenCalledWith('', { limit: 100 }));
		expect(screen.queryByText('That search could not be run.')).not.toBeInTheDocument();
		await ask(user, 'attention');

		expect(await screen.findByText('That search could not be run.')).toBeInTheDocument();
		expect(screen.getByText('no library is open')).toBeInTheDocument();
	});

	it('offers to prepare notes that a search by meaning cannot see', async () => {
		// Marks exist, and none of them has a vector — so searching by meaning
		// finds nothing for a reason the reader can act on.
		const user = userEvent.setup();
		db.searchNotes.mockResolvedValue([]);
		db.allAnnotations.mockResolvedValue([MARK]);

		render(Notes);
		await ask(user, 'attention');

		expect(await screen.findByText('Nothing found by meaning.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Prepare my notes' })).toBeInTheDocument();
	});

	it('embeds them when asked, and looks again', async () => {
		const user = userEvent.setup();
		db.searchNotes.mockResolvedValue([]);
		db.allAnnotations.mockResolvedValue([MARK]);
		db.embedPendingAnnotations.mockResolvedValue(3);

		render(Notes);
		await ask(user, 'attention');
		const prepare = await screen.findByRole('button', { name: 'Prepare my notes' });
		// Counted from here: browsing on mount and the question itself both search.
		const before = db.searchNotes.mock.calls.length;
		await user.click(prepare);

		await waitFor(() => expect(db.embedPendingAnnotations).toHaveBeenCalled());
		// And asks again, so a successful preparation shows its results at once.
		await waitFor(() => expect(db.searchNotes.mock.calls.length).toBeGreaterThan(before));
		expect(db.searchNotes.mock.calls.at(-1)?.[0]).toBe('attention');
	});

	it('does not blame preparation when a literal search finds nothing', async () => {
		// Searching by words does not use vectors, so an empty answer there means
		// what it says.
		const user = userEvent.setup();
		db.searchNotes.mockResolvedValue([]);
		db.allAnnotations.mockResolvedValue([MARK]);

		render(Notes);
		await user.type(screen.getByLabelText('Search your notes'), 'attention');
		await user.click(screen.getByRole('radio', { name: 'Words' }));

		expect(await screen.findByText('Nothing matches that.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Prepare my notes' })).not.toBeInTheDocument();
	});
});

describe('browsing, with nothing asked', () => {
	it('names each paper, and keeps marks from other projects apart', async () => {
		// Browsing listed every mark as "unknown paper" under "In this project":
		// the plain list it read carries neither the paper nor the project.
		db.searchNotes.mockResolvedValue([
			hit(MARK),
			hit({ ...MARK, id: 'a2', sha256: 'sha-2', in_project: false, file_name: 'elsewhere.pdf' })
		]);

		render(Notes);

		expect(await screen.findByText(/paper\.pdf/)).toBeInTheDocument();
		expect(screen.getByText(/elsewhere\.pdf/)).toBeInTheDocument();
		expect(screen.getByText('Elsewhere in your library')).toBeInTheDocument();
		expect(screen.queryByText(/unknown paper/)).not.toBeInTheDocument();
		expect(db.searchNotes).toHaveBeenCalledWith('', { limit: 100 });
	});
});

describe('following the writing', () => {
	it('says what it does, not how it works', async () => {
		render(Notes);

		expect(await screen.findByText("Show notes about the paragraph I'm in")).toBeInTheDocument();
		expect(
			screen.getByText('Updates as you write, by meaning. Typing a search here takes over.')
		).toBeInTheDocument();
	});

	it('turns off the words-or-meaning choice while it is the one deciding', async () => {
		// Following always searches by meaning, so with nothing typed this control
		// decides nothing — and a control that looks live but is not reads as
		// broken.
		const user = userEvent.setup();
		render(Notes);

		expect(await screen.findByRole('radio', { name: 'Meaning' })).toBeDisabled();
		await user.type(screen.getByLabelText('Search your notes'), 'attention');
		expect(screen.getByRole('radio', { name: 'Meaning' })).toBeEnabled();
	});
});

// M1b-3 AC-1: notes. A mark on a PDF attached to a book cites the book, and
// still opens the PDF (ADR 003).
describe('a mark on a file attached to a work', () => {
	it('cites the work and shows the file', async () => {
		const user = userEvent.setup();
		const cite = vi.fn(async () => {});
		draftContext.report({ cite });
		db.searchNotes.mockResolvedValue([hit({ ...MARK, source_id: 'erti:book' })]);

		render(Notes);

		await user.click(await screen.findByRole('button', { name: 'Cite' }));
		expect(cite).toHaveBeenCalledWith('erti:book');

		await user.click(screen.getByRole('button', { name: 'Show in PDF' }));
		expect(showInPdf).toHaveBeenCalledWith(expect.objectContaining({ sha256: 'sha-1', page: 4 }));
		draftContext.report({ cite: null });
	});
});

// M1b-8 AC-4: notes on a source, alongside the marks.
describe('a note on a source', () => {
	it('is listed with the marks, named by its work, and cites at its page', async () => {
		const user = userEvent.setup();
		const cite = vi.fn(async () => {});
		draftContext.report({ cite });
		db.searchNotes.mockResolvedValue([noteHit(SOURCE_NOTE), hit(MARK)]);

		render(Notes);

		expect(await screen.findByText('Additive rather than subordinative.')).toBeInTheDocument();
		expect(screen.getByText('· Orality and Literacy')).toBeInTheDocument();
		expect(screen.getByText('· p. 37')).toBeInTheDocument();
		// Said to be a note, not left to the colour of a label it hasn't got.
		expect(screen.getByText('Note')).toBeInTheDocument();
		// No file to show it in.
		expect(screen.getAllByRole('button', { name: 'Show in PDF' })).toHaveLength(1);

		await user.click(screen.getByRole('button', { name: 'Cite with p. 37' }));
		expect(cite).toHaveBeenCalledWith('erti:ong', '37');
		draftContext.report({ cite: null });
	});

	it('is in the follow list, and its work is reported to the margin', async () => {
		db.searchNotes.mockResolvedValue([noteHit(SOURCE_NOTE)]);
		const reported = vi.fn();
		const stop = draftMatches.subscribe(reported);

		render(Notes);
		draftContext.report({ paragraph: 'Oral cultures add rather than subordinate.' });

		await waitFor(() =>
			expect(db.searchNotes).toHaveBeenCalledWith('Oral cultures add rather than subordinate.', {
				semantic: true,
				limit: 20
			})
		);
		expect(await screen.findByText('Related to what you are writing')).toBeInTheDocument();
		expect(screen.getByText('Additive rather than subordinative.')).toBeInTheDocument();
		await waitFor(() =>
			expect(reported).toHaveBeenLastCalledWith(
				expect.objectContaining({ sources: [{ sha256: 'erti:ong', similarity: 0.7 }] })
			)
		);
		stop();
		draftContext.report({ paragraph: '' });
	});

	it('counts as a note a search by meaning could not see', async () => {
		const user = userEvent.setup();
		db.allSourceNotes.mockResolvedValue([SOURCE_NOTE]);

		render(Notes);
		await ask(user, 'pragmatics');

		expect(await screen.findByRole('button', { name: 'Prepare my notes' })).toBeInTheDocument();
	});
});

// M1b-8 AC-5
describe('exporting the notes', () => {
	it('writes notes on a source with the marks', async () => {
		const user = userEvent.setup();
		db.allAnnotations.mockResolvedValue([MARK]);
		db.allSourceNotes.mockResolvedValue([SOURCE_NOTE]);
		files.save.mockResolvedValue('/out/notes.json');

		render(Notes);
		await user.click(screen.getByRole('button', { name: 'JSON' }));

		await waitFor(() => expect(files.writeTextFile).toHaveBeenCalled());
		const [path, contents] = files.writeTextFile.mock.calls[0];
		expect(path).toBe('/out/notes.json');
		const written = JSON.parse(contents);
		expect(written.annotations.map((m: { id: string }) => m.id)).toEqual(['a1']);
		expect(written.source_notes.map((n: { id: string }) => n.id)).toEqual(['n1']);
	});

	it('has something to write when the only notes are on sources', async () => {
		const user = userEvent.setup();
		db.allSourceNotes.mockResolvedValue([SOURCE_NOTE]);
		files.save.mockResolvedValue('/out/notes.md');

		render(Notes);
		await user.click(screen.getByRole('button', { name: 'Markdown' }));

		await waitFor(() => expect(files.writeTextFile).toHaveBeenCalled());
		expect(files.writeTextFile.mock.calls[0][1]).toContain('> Oral structures look to pragmatics.');
	});
});
