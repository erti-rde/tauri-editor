import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import { IpcError } from '$lib/ipc';
import UiHarness from '$lib/ui/UiHarness.svelte';

import { augment, type OriginalZoteroSchema } from './adapterCslZotero';
import SourceSidebar from './SourceSidebar.svelte';

const db = vi.hoisted(() => ({
	addSourceByHand: vi.fn(async () => {}),
	setMetadataOverride: vi.fn(async () => {}),
	sourceFiles: vi.fn(async () => []),
	workNotes: vi.fn(async () => ({ notes: [], marks: [] }) as unknown),
	annotationLabels: vi.fn(async () => []),
	saveSourceNote: vi.fn(async () => {}),
	deleteSourceNote: vi.fn(async () => {}),
	sourceForDoi: vi.fn(async (): Promise<string | null> => null)
}));
vi.mock('$lib/stores/db', () => db);
vi.mock('$lib/toast/Toast.svelte', () => ({ errorToast: vi.fn(), successToast: vi.fn() }));

const schema = augment(
	JSON.parse(
		readFileSync(resolve('src-tauri/resources/csl/schema.json'), 'utf8')
	) as OriginalZoteroSchema
);

/** A chapter resolved before Erti kept the Zotero kind: only its CSL type says. */
const CHAPTER = {
	id: 'sha-chapter',
	title: 'The Ethnographic Present',
	csl: {
		id: 'sha-chapter',
		type: 'chapter',
		title: 'The Ethnographic Present',
		'container-title': 'Writing Culture',
		author: [{ family: 'Fabian', given: 'Johannes' }],
		issued: { 'date-parts': [[1986]] }
	},
	zoteroType: null
};

function open(record = CHAPTER) {
	const handlers = { onclose: vi.fn(), onsaved: vi.fn(), onremoved: vi.fn() };
	render(UiHarness, { props: { component: SourceSidebar, schema, record, ...handlers } });
	return handlers;
}

beforeEach(() => vi.clearAllMocks());

/**
 * Choose a kind from the keyboard, by its place among the common kinds (Book,
 * Book Section, Journal Article…): jsdom can't point at an option.
 */
function kindChooser(user: ReturnType<typeof userEvent.setup>) {
	return async (name: string, place: number) => {
		const trigger = screen.getByRole('button', { name: 'Kind of source' });
		trigger.focus();
		// jsdom leaves it marked open after a choice made by typing.
		if (trigger.getAttribute('aria-expanded') !== 'true') await user.keyboard('{Enter}');
		await screen.findByRole('listbox', { hidden: true });
		await user.keyboard('{Home}' + '{ArrowDown}'.repeat(place) + '{Enter}');
		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Kind of source' })).toHaveTextContent(name)
		);
	};
}

describe('the edit sidebar (M1b-5 AC-5)', () => {
	it('shows the kind and fields of a source from before the kind was kept', () => {
		open();

		expect(screen.getByRole('button', { name: 'Kind of source' })).toHaveTextContent(
			'Book Section'
		);
		expect(screen.getByRole('textbox', { name: 'Title (required)' })).toHaveValue(
			'The Ethnographic Present'
		);
		expect(screen.getByRole('textbox', { name: 'Book Title (required)' })).toHaveValue(
			'Writing Culture'
		);
		expect(screen.getByRole('textbox', { name: 'Date' })).toHaveValue('1986');
		expect(screen.getByRole('textbox', { name: 'Family name' })).toHaveValue('Fabian');
	});

	it('saves a correction for this project, kind included', async () => {
		const user = userEvent.setup();
		const { onsaved } = open();

		await user.type(screen.getByRole('textbox', { name: 'Pages' }), '51-76');
		await user.click(screen.getByRole('button', { name: 'Save' }));

		expect(db.setMetadataOverride).toHaveBeenCalledTimes(1);
		const [id, json] = db.setMetadataOverride.mock.calls[0] as unknown as [string, string];
		expect(id).toBe('sha-chapter');
		expect(JSON.parse(json)).toMatchObject({
			type: 'chapter',
			zotero_type: 'bookSection',
			'container-title': 'Writing Culture',
			page: '51-76'
		});
		expect(onsaved).toHaveBeenCalled();
	});
});

describe('required fields (M1b-5 AC-1)', () => {
	it('says what is missing instead of saving', async () => {
		const user = userEvent.setup();
		const { onsaved } = open();

		await user.clear(screen.getByRole('textbox', { name: 'Book Title (required)' }));
		await user.click(screen.getByRole('button', { name: 'Save' }));

		expect(screen.getByText('Enter the book title.')).toBeInTheDocument();
		expect(db.setMetadataOverride).not.toHaveBeenCalled();
		expect(onsaved).not.toHaveBeenCalled();
	});
});

describe('a new source (M1b-5 AC-1)', () => {
	it('asks for the kind first, and can’t be saved without one', () => {
		const handlers = { onclose: vi.fn(), onsaved: vi.fn(), onremoved: vi.fn() };
		render(UiHarness, { props: { component: SourceSidebar, schema, ...handlers } });

		expect(screen.getByRole('complementary', { name: 'New source' })).toBeInTheDocument();
		expect(screen.getByText('Choose what it is to see its fields.')).toBeInTheDocument();
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(screen.getByRole('button', { name: 'Add to library' })).toBeDisabled();
		expect(screen.queryByRole('button', { name: 'Remove from library…' })).toBeNull();
	});
});

describe('switching kind while entering one', () => {
	it('saves only what the chosen kind shows, not what was typed under another', async () => {
		const user = userEvent.setup();
		const handlers = { onclose: vi.fn(), onsaved: vi.fn(), onremoved: vi.fn() };
		render(UiHarness, { props: { component: SourceSidebar, schema, ...handlers } });
		const kind = kindChooser(user);

		await kind('Journal Article', 2);
		await user.type(screen.getByRole('textbox', { name: 'Title (required)' }), 'Orality');
		await user.type(
			screen.getByRole('textbox', { name: 'Publication Title (required)' }),
			'Nature'
		);
		await kind('Book', 0);
		// Kept for showing: the title carries over.
		expect(screen.getByRole('textbox', { name: 'Title (required)' })).toHaveValue('Orality');
		await user.click(screen.getByRole('button', { name: 'Add to library' }));

		expect(db.addSourceByHand).toHaveBeenCalledTimes(1);
		const [, json] = db.addSourceByHand.mock.calls[0] as unknown as [string, string, string];
		const item = JSON.parse(json);
		expect(item).toMatchObject({ type: 'book', title: 'Orality' });
		expect(item).not.toHaveProperty('container-title');
	});
});

describe('a new source from a DOI (M1b-6 AC-2)', () => {
	it('starts from the DOI, and keeps it whatever kind is chosen', async () => {
		const user = userEvent.setup();
		const handlers = { onclose: vi.fn(), onsaved: vi.fn(), onremoved: vi.fn() };
		render(UiHarness, {
			props: {
				component: SourceSidebar,
				schema,
				initial: { DOI: '10.1038/nature14539' },
				...handlers
			}
		});
		const kind = kindChooser(user);
		expect(screen.getByText('DOI 10.1038/nature14539, with no file')).toBeInTheDocument();

		await kind('Journal Article', 2);
		expect(screen.getByRole('textbox', { name: 'DOI' })).toHaveValue('10.1038/nature14539');
		await kind('Book', 0);
		await user.type(screen.getByRole('textbox', { name: 'Title (required)' }), 'Deep learning');
		await user.click(screen.getByRole('button', { name: 'Add to library' }));

		const [, json] = db.addSourceByHand.mock.calls[0] as unknown as [string, string, string];
		expect(JSON.parse(json)).toMatchObject({ type: 'book', DOI: '10.1038/nature14539' });
	});

	// M1b-6 AC-3: a DOI the library has opens that source, from the form too.
	it('opens the source the library has under the DOI, rather than a dead end', async () => {
		const user = userEvent.setup();
		db.addSourceByHand.mockRejectedValueOnce(
			new IpcError({
				kind: 'Conflict',
				message: 'A source with that DOI is already in the library.'
			})
		);
		db.sourceForDoi.mockResolvedValueOnce('erti:already');
		const onexisting = vi.fn();
		render(UiHarness, {
			props: {
				component: SourceSidebar,
				schema,
				initial: { DOI: '10.1038/nature14539' },
				onexisting,
				onclose: vi.fn(),
				onsaved: vi.fn(),
				onremoved: vi.fn()
			}
		});

		await kindChooser(user)('Book', 0);
		await user.type(screen.getByRole('textbox', { name: 'Title (required)' }), 'Deep learning');
		await user.click(screen.getByRole('button', { name: 'Add to library' }));

		await waitFor(() => expect(onexisting).toHaveBeenCalledWith('erti:already'));
		expect(db.sourceForDoi).toHaveBeenCalledWith('10.1038/nature14539');
	});
});

describe('the sidebar’s tabs (M1b-7 AC-3, UX-3)', () => {
	// M1b-8 AC-1
	it('shows a source’s details, its notes with their count, and its files in tabs', async () => {
		db.workNotes.mockResolvedValueOnce({
			notes: [{ id: 'n1' }, { id: 'n2' }],
			marks: [{ id: 'm1' }]
		});
		open();
		expect(db.workNotes).toHaveBeenCalledWith('sha-chapter');
		await waitFor(() =>
			expect(screen.getAllByRole('tab').map((tab) => tab.textContent?.trim())).toEqual([
				'Details',
				'Notes (3)',
				'File'
			])
		);
		expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
	});

	// M1b-8 AC-2
	it('saves the details from their own tab: a note has its own Save', async () => {
		const user = userEvent.setup();
		open();
		expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

		await user.click(screen.getByRole('tab', { name: /^Notes/ }));

		expect(await screen.findByRole('button', { name: 'New note' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Remove from library…' })).toBeInTheDocument();
	});

	it('lists the files when their tab is chosen, not on opening', async () => {
		const user = userEvent.setup();
		open();
		expect(db.sourceFiles).not.toHaveBeenCalled();

		await user.click(screen.getByRole('tab', { name: 'File' }));
		await waitFor(() => expect(db.sourceFiles).toHaveBeenCalledWith('sha-chapter'));
	});

	it('has no tabs for a source being entered, which has no file yet', () => {
		render(UiHarness, {
			props: {
				component: SourceSidebar,
				schema,
				onclose: vi.fn(),
				onsaved: vi.fn(),
				onremoved: vi.fn()
			}
		});
		expect(screen.queryAllByRole('tab')).toHaveLength(0);
	});
});
