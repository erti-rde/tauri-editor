import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';

import Notes from './Notes.svelte';
import { draftContext, draftMatches } from './draftContext';
import { followSetting } from './writingSettings';
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
	searchLibrary: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
	embedPendingAnnotations: vi.fn<() => Promise<number>>(async () => 0),
	projectSources: vi.fn<() => Promise<unknown[]>>(async () => []),
	sourceAliases: vi.fn<() => Promise<Record<string, string>>>(async () => ({})),
	annotationLabels: vi.fn<() => Promise<unknown[]>>(async () => [])
}));
vi.mock('$lib/stores/db', () => db);

/** The settings file: what the writer chose last time, if anything. */
const stored = vi.hoisted(() => new Map<string, unknown>());

const files = vi.hoisted(() => ({
	save: vi.fn<() => Promise<string | null>>(async () => null),
	writeTextFile: vi.fn<(path: string, contents: string) => Promise<void>>(async () => {})
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: files.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: files.writeTextFile }));
vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn(async () => ({
		get: vi.fn(async (key: string) => stored.get(key)),
		set: vi.fn(async (key: string, value: unknown) => void stored.set(key, value)),
		save: vi.fn()
	}))
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
	page_label: null as string | null,
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
	page_label: '37' as string | null,
	label_id: null,
	created_at: '2026-01-02',
	updated_at: '2026-01-02',
	similarity: 0.7,
	source_id: 'erti:ong',
	in_project: true,
	title: 'Orality and Literacy'
};
const noteHit = (note: typeof SOURCE_NOTE) => ({ kind: 'source_note', hit: note });

const PASSAGE = {
	sha256: 'sha-3',
	source_id: 'erti:vaswani',
	idx: 7,
	text: 'The Transformer allows for significantly more parallelisation.',
	page_start: 2,
	section: null,
	title: 'Attention Is All You Need',
	similarity: 0.6,
	in_project: true
};
const passageHit = (passage: typeof PASSAGE) => ({ kind: 'chunk', hit: passage });

const PARAGRAPH = 'Sequence models built on recurrence process one token at a time.';

/** What following finds: notes when asked for notes, passages when asked for passages. */
function following(notes: unknown[], passages: unknown[]) {
	db.searchLibrary.mockImplementation(async (_query, options) =>
		(options as { kinds: string[] }).kinds.includes('chunk') ? passages : notes
	);
}

/** Leave the shared channel as the next test expects to find it. */
function stopWriting() {
	draftContext.report({ paragraph: '', cited: [], cite: null });
}

beforeEach(async () => {
	// Following is on unless a test turns it off, as on a first launch.
	await followSetting.setEnabled(true);
	vi.clearAllMocks();
	db.allAnnotations.mockResolvedValue([]);
	db.allSourceNotes.mockResolvedValue([]);
	db.searchNotes.mockResolvedValue([]);
	db.searchLibrary.mockResolvedValue([]);
	db.annotationLabels.mockResolvedValue([]);
});

async function ask(user: ReturnType<typeof userEvent.setup>, words: string) {
	await user.type(screen.getByLabelText('Search your notes'), words);
	await user.click(screen.getByRole('radio', { name: 'Meaning' }));
}

/**
 * Nothing found by the search itself, though a note exists: what an unprepared
 * library looks like. Only the one-result check for any note at all finds it.
 */
function onlyTheCheckForAnyNoteFinds(found: unknown) {
	db.searchNotes.mockImplementation(async (query, options) =>
		query === '' && (options as { limit?: number } | undefined)?.limit === 1 ? [found] : []
	);
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
		onlyTheCheckForAnyNoteFinds(hit(MARK));

		render(Notes);
		await ask(user, 'attention');

		expect(await screen.findByText('Nothing found by meaning.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Prepare my notes' })).toBeInTheDocument();
	});

	it('embeds them when asked, and looks again', async () => {
		const user = userEvent.setup();
		onlyTheCheckForAnyNoteFinds(hit(MARK));
		db.embedPendingAnnotations.mockResolvedValue(3);

		render(Notes);
		await ask(user, 'attention');
		const prepare = await screen.findByRole('button', { name: 'Prepare my notes' });
		// Counted from here: browsing on mount and the question itself both search.
		const before = db.searchNotes.mock.calls.length;
		await user.click(prepare);

		await waitFor(() => expect(db.embedPendingAnnotations).toHaveBeenCalled());
		// And asks again, so a successful preparation shows its results at once.
		// (Finding nothing again, it checks for any note after, so not the last call.)
		await waitFor(() =>
			expect(db.searchNotes.mock.calls.slice(before).map(([query]) => query)).toContain('attention')
		);
	});

	it('does not blame preparation when a literal search finds nothing', async () => {
		// Searching by words does not use vectors, so an empty answer there means
		// what it says.
		const user = userEvent.setup();
		db.searchNotes.mockResolvedValue([]);
		db.allAnnotations.mockResolvedValue([MARK]);

		render(Notes);
		await user.type(screen.getByLabelText('Search your notes'), 'attention{Enter}');

		expect(await screen.findByText('Nothing matches that.')).toBeInTheDocument();
		expect(db.searchNotes).toHaveBeenLastCalledWith('attention', { semantic: false, limit: 100 });
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
	// M3-1 AC-1
	it('is a switch in the header, saying which paragraph it follows', async () => {
		following([hit(MARK)], []);
		render(Notes);

		const toggle = await screen.findByRole('switch', { name: 'Follow my writing' });
		expect(toggle).toBeChecked();
		expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

		draftContext.report({ paragraph: PARAGRAPH });
		expect(await screen.findByText('Sequence models built on recurrence…')).toBeInTheDocument();
		expect(screen.getByText(/Related to:/)).toBeInTheDocument();
		stopWriting();
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

		await user.click(await screen.findByRole('button', { name: 'Cite with p. 4' }));
		expect(cite).toHaveBeenCalledWith('erti:book', '4');

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
		following([noteHit(SOURCE_NOTE)], []);
		const reported = vi.fn();
		const stop = draftMatches.subscribe(reported);

		render(Notes);
		draftContext.report({ paragraph: 'Oral cultures add rather than subordinate.' });

		await waitFor(() =>
			expect(db.searchLibrary).toHaveBeenCalledWith('Oral cultures add rather than subordinate.', {
				kinds: ['annotation', 'source_note'],
				limit: 20,
				includeLibrary: true
			})
		);
		expect(await screen.findByText('Additive rather than subordinative.')).toBeInTheDocument();
		await waitFor(() =>
			expect(reported).toHaveBeenLastCalledWith(
				expect.objectContaining({ sources: [{ sha256: 'erti:ong', similarity: 0.7 }] })
			)
		);
		stop();
		stopWriting();
	});

	it('counts as a note a search by meaning could not see', async () => {
		const user = userEvent.setup();
		onlyTheCheckForAnyNoteFinds(noteHit(SOURCE_NOTE));

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

// M3-1: notes and passages follow the paragraph.
describe('following the paragraph', () => {
	// M3-1 AC-2
	it('shows your notes and passages from your papers, each counted, with source and page', async () => {
		following(
			[hit(MARK), noteHit(SOURCE_NOTE)],
			[passageHit(PASSAGE), passageHit({ ...PASSAGE, idx: 8, page_start: 5, text: 'Another.' })]
		);
		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH });

		expect(await screen.findByRole('heading', { name: 'Your notes (2)' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'From your papers (2)' })).toBeInTheDocument();
		// A mark: its paper and page. A source note: its work and page.
		expect(screen.getByText(/paper\.pdf/)).toBeInTheDocument();
		expect(screen.getByText('· p. 4')).toBeInTheDocument();
		expect(screen.getByText('· Orality and Literacy')).toBeInTheDocument();
		expect(screen.getByText('· p. 37')).toBeInTheDocument();
		// A passage: its work and page, and the passage itself.
		expect(screen.getAllByText('Attention Is All You Need')).toHaveLength(2);
		expect(screen.getByText('· p. 2')).toBeInTheDocument();
		expect(screen.getByText('· p. 5')).toBeInTheDocument();
		expect(screen.getByText(PASSAGE.text)).toBeInTheDocument();
		stopWriting();
	});

	// M3-1 AC-2
	it('opens a passage in its PDF, and cites its work', async () => {
		const user = userEvent.setup();
		const cite = vi.fn(async () => {});
		following([], [passageHit(PASSAGE)]);
		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH, cite });

		await screen.findByText(PASSAGE.text);
		await user.click(screen.getByRole('button', { name: 'Show in PDF' }));
		expect(showInPdf).toHaveBeenCalledWith({
			sha256: 'sha-3',
			page: 2,
			selector: { quote: PASSAGE.text }
		});
		await user.click(screen.getByRole('button', { name: 'Cite with p. 2' }));
		expect(cite).toHaveBeenCalledWith('erti:vaswani', '2');
		stopWriting();
	});

	// M3-1 AC-3: the editor decides when (draftContext.test.ts); the panel asks
	// once for each paragraph it's told of, and not again for the same one.
	it('searches once per paragraph it is told of, never again for the same words', async () => {
		following([hit(MARK)], []);
		render(Notes);

		draftContext.report({ paragraph: PARAGRAPH });
		await screen.findByRole('heading', { name: 'Your notes (1)' });
		draftContext.report({ paragraph: PARAGRAPH, cited: [] });
		draftContext.report({ paragraph: PARAGRAPH });
		await new Promise((settle) => setTimeout(settle, 20));

		// Notes and passages: one search each.
		expect(db.searchLibrary).toHaveBeenCalledTimes(2);
		expect(db.searchLibrary.mock.calls.map(([query]) => query)).toEqual([PARAGRAPH, PARAGRAPH]);
		stopWriting();
	});

	// M3-1 AC-4
	it('marks what the paragraph already cites, and puts it last', async () => {
		following(
			[
				hit({ ...MARK, id: 'cited-mark', source_id: 'erti:cited', file_name: 'cited.pdf' }),
				hit(MARK)
			],
			[
				passageHit({ ...PASSAGE, source_id: 'erti:cited', title: 'Already cited' }),
				passageHit({ ...PASSAGE, idx: 9, text: 'Not yet cited.' })
			]
		);
		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH, cited: ['erti:cited'] });

		await screen.findByRole('heading', { name: 'Your notes (2)' });
		const rows = (text: RegExp) =>
			screen.getAllByText(text).map((el) => el.closest('.border-b')?.textContent ?? '');
		const notes = rows(/\.pdf$/);
		expect(notes[0]).toContain('paper.pdf');
		expect(notes[1]).toContain('cited.pdf');
		expect(notes[1]).toContain('cited here');
		expect(notes[0]).not.toContain('cited here');

		const papers = rows(/^(Already cited|Attention Is All You Need)$/);
		expect(papers[0]).toContain('Not yet cited.');
		expect(papers[1]).toContain('Already cited');
		expect(papers[1]).toContain('cited here');
		expect(screen.getAllByText('· cited here')).toHaveLength(2);
		stopWriting();
	});

	// M3-1 AC-4: citing from the panel marks the result without searching again.
	it('marks a result once it is cited, without searching again', async () => {
		following([hit(MARK)], []);
		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH });
		await screen.findByRole('heading', { name: 'Your notes (1)' });
		expect(screen.queryByText('· cited here')).not.toBeInTheDocument();

		draftContext.report({ cited: ['sha-1'] });

		expect(await screen.findByText('· cited here')).toBeInTheDocument();
		expect(db.searchLibrary).toHaveBeenCalledTimes(2);
		stopWriting();
	});

	// M3-1 AC-5
	it('gives way to a typed search, and follows again once the search is cleared', async () => {
		const user = userEvent.setup();
		following([hit(MARK)], [passageHit(PASSAGE)]);
		db.searchNotes.mockResolvedValue([
			hit({ ...MARK, id: 'typed', file_name: 'typed.pdf', in_project: true })
		]);
		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH });
		await screen.findByRole('heading', { name: 'From your papers (1)' });

		await user.type(screen.getByLabelText('Search your notes'), 'attention{Enter}');
		expect(await screen.findByText(/typed\.pdf/)).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: /From your papers/ })).not.toBeInTheDocument();
		expect(screen.queryByText(/Related to:/)).not.toBeInTheDocument();
		// The writing moving on doesn't take the search away.
		draftContext.report({ paragraph: `${PARAGRAPH} And more.` });
		await new Promise((settle) => setTimeout(settle, 20));
		expect(db.searchLibrary).toHaveBeenCalledTimes(2);

		await user.clear(screen.getByLabelText('Search your notes'));

		expect(
			await screen.findByRole('heading', { name: 'From your papers (1)' })
		).toBeInTheDocument();
		expect(db.searchLibrary).toHaveBeenLastCalledWith(`${PARAGRAPH} And more.`, {
			kinds: ['chunk'],
			limit: 10,
			includeLibrary: true
		});
		stopWriting();
	});

	it('lets a newer paragraph keep the margin when an older one answers late', async () => {
		const LATER = 'Attention lets every token look at every other token at once.';
		db.searchLibrary.mockImplementation(async (query, options) =>
			query === LATER && !(options as { kinds: string[] }).kinds.includes('chunk')
				? [hit(MARK)]
				: []
		);
		// The first paragraph finds no notes, so it asks whether any exist, and
		// that answer is held back until the next paragraph has been answered.
		let answer: (found: unknown[]) => void = () => {};
		db.searchNotes.mockImplementation(
			() => new Promise<unknown[]>((resolve) => (answer = resolve))
		);
		const reported = vi.fn();
		const stop = draftMatches.subscribe(reported);

		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH });
		await waitFor(() => expect(db.searchNotes).toHaveBeenCalledWith('', { limit: 1 }));
		draftContext.report({ paragraph: LATER });
		await screen.findByRole('heading', { name: 'Your notes (1)' });
		answer([hit(MARK)]);
		await new Promise((settle) => setTimeout(settle, 20));

		expect(reported).toHaveBeenLastCalledWith(expect.objectContaining({ paragraph: LATER }));
		expect(screen.queryByRole('button', { name: 'Prepare my notes' })).not.toBeInTheDocument();
		stop();
		stopWriting();
	});

	it('lists every note again when switched off', async () => {
		const user = userEvent.setup();
		following([hit(MARK)], []);
		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH });
		await screen.findByRole('heading', { name: 'Your notes (1)' });

		await user.click(screen.getByRole('switch', { name: 'Follow my writing' }));

		await waitFor(() => expect(db.searchNotes).toHaveBeenLastCalledWith('', { limit: 100 }));
		expect(screen.queryByRole('heading', { name: /Your notes/ })).not.toBeInTheDocument();
		// And the margin stops pointing at what following found.
		expect(get(draftMatches)).toEqual({ paragraph: '', sources: [] });
		stopWriting();
	});
});

// M3-2: Cite on a note, a mark or a passage takes its page.
describe('citing at a page', () => {
	// M3-2 AC-1: the page the paper prints, when the mark knows it.
	it('cites a mark at the page its paper prints', async () => {
		const user = userEvent.setup();
		const cite = vi.fn(async () => {});
		following([hit({ ...MARK, page: 4, page_label: '846' })], []);
		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH, cite });

		await user.click(await screen.findByRole('button', { name: 'Cite with p. 846' }));
		expect(cite).toHaveBeenCalledWith('sha-1', '846');
		stopWriting();
	});

	// M3-2 AC-1: else the sheet, for a mark and for a passage alike.
	it('cites a mark or a passage at its sheet when nothing printed is known', async () => {
		const user = userEvent.setup();
		const cite = vi.fn(async () => {});
		following([hit(MARK)], [passageHit({ ...PASSAGE, page_start: 5 })]);
		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH, cite });

		await user.click(await screen.findByRole('button', { name: 'Cite with p. 4' }));
		expect(cite).toHaveBeenLastCalledWith('sha-1', '4');
		await user.click(screen.getByRole('button', { name: 'Cite with p. 5' }));
		expect(cite).toHaveBeenLastCalledWith('erti:vaswani', '5');
		stopWriting();
	});

	// M3-2 AC-1: a source note with no page cites the work alone.
	it('cites a source note with no page as the work alone', async () => {
		const user = userEvent.setup();
		const cite = vi.fn(async () => {});
		following([noteHit({ ...SOURCE_NOTE, page_label: null })], []);
		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH, cite });

		await user.click(await screen.findByRole('button', { name: 'Cite' }));
		expect(cite).toHaveBeenCalledWith('erti:ong', undefined);
		stopWriting();
	});

	// M3-2 AC-2: a note from elsewhere in the library is offered too, and
	// citing it is the editor's (citeWork.test.ts adds it to the project).
	it('offers to cite a note from outside the project', async () => {
		const user = userEvent.setup();
		const cite = vi.fn(async () => {});
		following([noteHit({ ...SOURCE_NOTE, in_project: false })], []);
		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH, cite });

		await user.click(await screen.findByRole('button', { name: 'Cite with p. 37' }));
		expect(cite).toHaveBeenCalledWith('erti:ong', '37');
		stopWriting();
	});
});

// M3-4: whether the panel follows is remembered.
describe('the follow switch, remembered', () => {
	// M3-4 AC-1
	it('stays off once turned off, for the next time the panel opens', async () => {
		const user = userEvent.setup();
		following([hit(MARK)], []);
		const first = render(Notes);
		draftContext.report({ paragraph: PARAGRAPH });
		await screen.findByRole('heading', { name: 'Your notes (1)' });

		await user.click(screen.getByRole('switch', { name: 'Follow my writing' }));
		await waitFor(() => expect(stored.get('followWriting')).toBe(false));
		first.unmount();

		db.searchLibrary.mockClear();
		render(Notes);
		expect(await screen.findByRole('switch', { name: 'Follow my writing' })).not.toBeChecked();
		await waitFor(() => expect(db.searchNotes).toHaveBeenLastCalledWith('', { limit: 100 }));
		expect(db.searchLibrary).not.toHaveBeenCalled();
		stopWriting();
	});

	// M3-4 AC-1: turned off in Settings, the open panel stops following too.
	it('follows the setting when it changes elsewhere', async () => {
		following([hit(MARK)], []);
		render(Notes);
		draftContext.report({ paragraph: PARAGRAPH });
		await screen.findByRole('heading', { name: 'Your notes (1)' });

		await followSetting.setEnabled(false);

		expect(await screen.findByRole('switch', { name: 'Follow my writing' })).not.toBeChecked();
		await waitFor(() => expect(db.searchNotes).toHaveBeenLastCalledWith('', { limit: 100 }));
		expect(screen.queryByRole('heading', { name: /Your notes/ })).not.toBeInTheDocument();
		stopWriting();
	});
});

// M3-5: what the panel says when it has nothing to show, each in its own words.
describe('saying what happened', () => {
	const NO_NOTES = "No notes on this project's sources yet.";
	const NO_NOTES_DETAIL = 'Highlight in a PDF, or add a note to a source.';
	const NOTHING_CLOSE = 'Nothing in your notes or papers is close to this paragraph.';
	const NO_MANUSCRIPT = /No manuscript open/;

	// M3-5 AC-1, AC-2: no notes on this project's sources yet.
	describe('with no notes yet', () => {
		it('says so, and how to make one, rather than an empty list', async () => {
			render(Notes);

			expect(await screen.findByText(NO_NOTES)).toBeInTheDocument();
			expect(screen.getByText(NO_NOTES_DETAIL)).toBeInTheDocument();
			expect(screen.queryByText(NOTHING_CLOSE)).not.toBeInTheDocument();
		});

		it('says so while following, not that nothing is close', async () => {
			// Nothing to find is not the paragraph's fault, and saying it was
			// would send the writer rewording a paragraph to no end.
			following([], []);
			draftContext.report({ paragraph: PARAGRAPH, cite: async () => {} });
			render(Notes);

			expect(await screen.findByText(NO_NOTES)).toBeInTheDocument();
			expect(screen.queryByText(NOTHING_CLOSE)).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Prepare my notes' })).not.toBeInTheDocument();
			stopWriting();
		});

		it('says so beside the passages, when the papers had something', async () => {
			following([], [passageHit(PASSAGE)]);
			draftContext.report({ paragraph: PARAGRAPH, cite: async () => {} });
			render(Notes);

			expect(await screen.findByRole('heading', { name: 'Your notes (0)' })).toBeInTheDocument();
			// One line under the heading, the message and what to do about it.
			expect(screen.getByText(`${NO_NOTES} ${NO_NOTES_DETAIL}`)).toBeInTheDocument();
			expect(screen.getByRole('heading', { name: 'From your papers (1)' })).toBeInTheDocument();
			stopWriting();
		});

		it('says so above notes from other projects, which are still listed', async () => {
			db.searchNotes.mockResolvedValue([hit({ ...MARK, in_project: false })]);
			render(Notes);

			expect(await screen.findByText(NO_NOTES)).toBeInTheDocument();
			expect(
				screen.getByRole('heading', { name: 'Elsewhere in your library' })
			).toBeInTheDocument();
			expect(screen.getByText('the effect was strongest')).toBeInTheDocument();
		});
	});

	// M3-5 AC-1, AC-2: nothing close to this paragraph.
	describe('with nothing close to the paragraph', () => {
		it('says so, rather than listing the nearest however far', async () => {
			// The index always answers with its nearest rows. A paragraph on
			// something no note is about shouldn't be shown notes on other things.
			following(
				[hit({ ...MARK, similarity: 0.12 })],
				[passageHit({ ...PASSAGE, similarity: 0.3 })]
			);
			draftContext.report({ paragraph: PARAGRAPH, cite: async () => {} });
			render(Notes);

			expect(await screen.findByText(NOTHING_CLOSE)).toBeInTheDocument();
			expect(screen.queryByText(NO_NOTES)).not.toBeInTheDocument();
			expect(screen.queryByText('the effect was strongest')).not.toBeInTheDocument();
			// A note was found, so nothing is waiting to be prepared.
			expect(screen.queryByRole('button', { name: 'Prepare my notes' })).not.toBeInTheDocument();
			stopWriting();
		});

		it('lists what is close and leaves out what is not', async () => {
			following(
				[hit(MARK), noteHit({ ...SOURCE_NOTE, similarity: 0.2 })],
				[passageHit(PASSAGE), passageHit({ ...PASSAGE, idx: 8, similarity: 0.3 })]
			);
			draftContext.report({ paragraph: PARAGRAPH, cite: async () => {} });
			render(Notes);

			expect(await screen.findByRole('heading', { name: 'Your notes (1)' })).toBeInTheDocument();
			expect(screen.getByRole('heading', { name: 'From your papers (1)' })).toBeInTheDocument();
			expect(screen.queryByText('Additive rather than subordinative.')).not.toBeInTheDocument();
			stopWriting();
		});
	});

	// M3-5 AC-1, AC-2: the search failed, with the reason.
	describe('when the search fails', () => {
		it('says so while following, with the reason', async () => {
			db.searchLibrary.mockRejectedValue(new Error('The index is still being built.'));
			draftContext.report({ paragraph: PARAGRAPH, cite: async () => {} });
			render(Notes);

			expect(await screen.findByText('That search could not be run.')).toBeInTheDocument();
			expect(screen.getByText('The index is still being built.')).toBeInTheDocument();
			expect(screen.queryByText(NOTHING_CLOSE)).not.toBeInTheDocument();
			expect(screen.queryByText(NO_NOTES)).not.toBeInTheDocument();
			stopWriting();
		});
	});

	// M3-5 AC-1, AC-2: no manuscript open.
	describe('with no manuscript open', () => {
		it('says there is nothing to follow, and still lists the notes', async () => {
			db.searchNotes.mockResolvedValue([hit(MARK)]);
			render(Notes);

			expect(await screen.findByText(NO_MANUSCRIPT)).toBeInTheDocument();
			expect(await screen.findByText('the effect was strongest')).toBeInTheDocument();
			expect(db.searchLibrary).not.toHaveBeenCalled();
		});

		it('says nothing of it once a manuscript is open', async () => {
			draftContext.report({ cite: async () => {} });
			render(Notes);
			await waitFor(() => expect(db.searchNotes).toHaveBeenCalled());

			expect(screen.queryByText(NO_MANUSCRIPT)).not.toBeInTheDocument();
			stopWriting();
		});

		it('says nothing of it when not following', async () => {
			await followSetting.setEnabled(false);
			render(Notes);
			await waitFor(() => expect(db.searchNotes).toHaveBeenCalled());

			expect(screen.queryByText(NO_MANUSCRIPT)).not.toBeInTheDocument();
		});
	});

	it('says each in different words', async () => {
		// Four situations, four things to do about them: words shared between
		// two would leave the reader guessing which one this is.
		const said = [NO_NOTES, NOTHING_CLOSE, 'That search could not be run.', 'No manuscript open.'];
		expect(new Set(said).size).toBe(4);
	});
});
