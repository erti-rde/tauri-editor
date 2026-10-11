import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';

import { citeWork } from './citeWork';

/**
 * Citing from the Notes panel: a note, a mark or a passage (M3-2). The project
 * and the engine are stood in for, so these are about what reaches the
 * manuscript and what joins the project.
 */

const project = vi.hoisted(() => ({
	/** The works the engine can render, as the project lists them. */
	works: new Set<string>(),
	/** What the library holds and would bring with it on joining. */
	library: new Set<string>(),
	aliases: {} as Record<string, string>
}));

vi.mock('$lib/stores/citationStore', () => ({
	citationStore: {
		canonicalId: (id: string) => project.aliases[id] ?? id,
		getAllSourcesAsJson: () =>
			Object.fromEntries([...project.works].map((id) => [id, { id, title: id }])),
		initializeCitationStore: vi.fn(async () => {}),
		previewCitation: (ids: string[], locators: Record<string, string>) =>
			`(${ids.map((id) => [id, locators[id] && `p. ${locators[id]}`].filter(Boolean).join(', ')).join('; ')})`
	}
}));

const db = vi.hoisted(() => ({
	addToProject: vi.fn(async (id: string) => {
		if (project.library.has(id)) project.works.add(id);
	})
}));
vi.mock('$lib/stores/db', () => db);

const toast = vi.hoisted(() => ({ errorToast: vi.fn(), successToast: vi.fn() }));
vi.mock('$lib/toast/Toast.svelte', () => toast);

function editor() {
	const insertCitation = vi.fn();
	return { editor: { commands: { insertCitation } } as unknown as Editor, insertCitation };
}

beforeEach(() => {
	project.works = new Set(['erti:vaswani']);
	project.library = new Set(['erti:vaswani', 'erti:ong']);
	project.aliases = {};
	vi.clearAllMocks();
});

describe('citing from a note, a mark or a passage', () => {
	// M3-2 AC-1: the caller gives the page, printed or sheet; it goes with the work.
	it('inserts a citation with the page as its locator', async () => {
		const { editor: view, insertCitation } = editor();

		await citeWork(view, 'erti:vaswani', ' 843 ');

		expect(insertCitation).toHaveBeenCalledWith({
			id: JSON.stringify(['erti:vaswani']),
			label: '(erti:vaswani, p. 843)',
			locators: { 'erti:vaswani': '843' }
		});
	});

	// M3-2 AC-1: a source note with no page has nothing to point at.
	it('cites the work alone when there is no page', async () => {
		const { editor: view, insertCitation } = editor();

		await citeWork(view, 'erti:vaswani', '  ');

		expect(insertCitation).toHaveBeenCalledWith(
			expect.objectContaining({ label: '(erti:vaswani)', locators: null })
		);
	});

	it('cites the work by its canonical id, whichever id the note had', async () => {
		const { editor: view, insertCitation } = editor();
		project.aliases = { 'sha-file': 'erti:vaswani' };

		await citeWork(view, 'sha-file', '2');

		expect(insertCitation).toHaveBeenCalledWith(
			expect.objectContaining({ locators: { 'erti:vaswani': '2' } })
		);
		expect(db.addToProject).not.toHaveBeenCalled();
	});

	// M3-2 AC-2
	it('adds a work from elsewhere in the library to the project, then cites it', async () => {
		const { editor: view, insertCitation } = editor();

		await citeWork(view, 'erti:ong', '37');

		expect(db.addToProject).toHaveBeenCalledWith('erti:ong');
		expect(project.works.has('erti:ong')).toBe(true);
		expect(insertCitation).toHaveBeenCalledWith(
			expect.objectContaining({ id: JSON.stringify(['erti:ong']), locators: { 'erti:ong': '37' } })
		);
	});

	// M3-2 AC-2, as before M3: a work with no citation details joins, and says so.
	it('says what to do when the work joined but cannot be cited yet', async () => {
		const { editor: view, insertCitation } = editor();

		await citeWork(view, 'erti:bare', '1');

		expect(db.addToProject).toHaveBeenCalledWith('erti:bare');
		expect(insertCitation).not.toHaveBeenCalled();
		expect(toast.errorToast).toHaveBeenCalledWith(expect.stringContaining('no citation details'));
	});

	it('says so when the project could not take it', async () => {
		const { editor: view, insertCitation } = editor();
		db.addToProject.mockRejectedValueOnce(new Error('locked'));

		await citeWork(view, 'erti:ong', '37');

		expect(insertCitation).not.toHaveBeenCalled();
		expect(toast.errorToast).toHaveBeenCalledWith('Could not cite that paper.');
	});
});
