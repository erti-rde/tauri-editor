import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import Notes from './Notes.svelte';

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
	searchAnnotations: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
	embedPendingAnnotations: vi.fn<() => Promise<number>>(async () => 0),
	projectSources: vi.fn<() => Promise<unknown[]>>(async () => []),
	annotationLabels: vi.fn<() => Promise<unknown[]>>(async () => [])
}));
vi.mock('$lib/stores/db', () => db);

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn() }));
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
	in_project: true,
	file_name: 'paper.pdf'
};

beforeEach(() => {
	vi.clearAllMocks();
	db.allAnnotations.mockResolvedValue([]);
	db.searchAnnotations.mockResolvedValue([]);
	db.annotationLabels.mockResolvedValue([]);
});

async function ask(user: ReturnType<typeof userEvent.setup>, words: string) {
	await user.type(screen.getByLabelText('Search your notes'), words);
	await user.click(screen.getByRole('button', { name: 'Meaning' }));
}

describe('when there is nothing to show', () => {
	it('says a search failed rather than going blank', async () => {
		const user = userEvent.setup();
		db.searchAnnotations.mockRejectedValue(new Error('no library is open'));

		render(Notes);
		await ask(user, 'attention');

		expect(await screen.findByText('That search could not be run.')).toBeInTheDocument();
		expect(screen.getByText('no library is open')).toBeInTheDocument();
	});

	it('offers to prepare notes that a search by meaning cannot see', async () => {
		// Marks exist, and none of them has a vector — so searching by meaning
		// finds nothing for a reason the reader can act on.
		const user = userEvent.setup();
		db.searchAnnotations.mockResolvedValue([]);
		db.allAnnotations.mockResolvedValue([MARK]);

		render(Notes);
		await ask(user, 'attention');

		expect(await screen.findByText('Nothing found by meaning.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Prepare my notes' })).toBeInTheDocument();
	});

	it('embeds them when asked, and looks again', async () => {
		const user = userEvent.setup();
		db.searchAnnotations.mockResolvedValue([]);
		db.allAnnotations.mockResolvedValue([MARK]);
		db.embedPendingAnnotations.mockResolvedValue(3);

		render(Notes);
		await ask(user, 'attention');
		await user.click(await screen.findByRole('button', { name: 'Prepare my notes' }));

		await waitFor(() => expect(db.embedPendingAnnotations).toHaveBeenCalled());
		// And asks again, so a successful preparation shows its results at once.
		await waitFor(() => expect(db.searchAnnotations.mock.calls.length).toBeGreaterThan(1));
	});

	it('does not blame preparation when a literal search finds nothing', async () => {
		// Searching by words does not use vectors, so an empty answer there means
		// what it says.
		const user = userEvent.setup();
		db.searchAnnotations.mockResolvedValue([]);
		db.allAnnotations.mockResolvedValue([MARK]);

		render(Notes);
		await user.type(screen.getByLabelText('Search your notes'), 'attention');
		await user.click(screen.getByRole('button', { name: 'Words' }));

		expect(await screen.findByText('Nothing matches that.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Prepare my notes' })).not.toBeInTheDocument();
	});
});

describe('browsing, with nothing asked', () => {
	it('names each paper, and keeps marks from other projects apart', async () => {
		// Browsing listed every mark as "unknown paper" under "In this project":
		// the plain list it read carries neither the paper nor the project.
		db.searchAnnotations.mockResolvedValue([
			MARK,
			{ ...MARK, id: 'a2', sha256: 'sha-2', in_project: false, file_name: 'elsewhere.pdf' }
		]);

		render(Notes);

		expect(await screen.findByText(/paper\.pdf/)).toBeInTheDocument();
		expect(screen.getByText(/elsewhere\.pdf/)).toBeInTheDocument();
		expect(screen.getByText('Elsewhere in your library')).toBeInTheDocument();
		expect(screen.queryByText(/unknown paper/)).not.toBeInTheDocument();
		expect(db.searchAnnotations).toHaveBeenCalledWith('', { limit: 100 });
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

	it('dims the words-or-meaning choice while it is the one deciding', async () => {
		// Following always searches by meaning, so with nothing typed this control
		// decides nothing — and a control that looks live but is not reads as
		// broken.
		render(Notes);

		const how = await screen.findByRole('group', { name: 'How to search' });
		expect(how).toHaveAttribute('aria-disabled', 'true');
	});
});
