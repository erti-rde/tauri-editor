import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import { defaultFixture } from '$lib/harness/fixture';
import { useFakeBackend } from '$lib/harness/testing';
import * as db from '$lib/stores/db';
import NewProject from './NewProject.svelte';

// The real store over the fake backend, with `importSources` there to stop.
vi.mock('$lib/stores/db', async (original) => {
	const real = await original<typeof import('$lib/stores/db')>();
	return { ...real, importSources: vi.fn(real.importSources) };
});

/**
 * Landing › New project… (M1b-11, docs/ux.md UX-13), on the fake backend:
 * its Zotero is the one `harness/fakeZotero.ts` draws.
 */

const PLACE = '/fake/home/Documents';
const row = (name: string) => screen.getByRole('treeitem', { name: new RegExp(`^${name}`) });

function setup(backend: ReturnType<ReturnType<typeof useFakeBackend>>) {
	const user = userEvent.setup();
	const onready = vi.fn(async () => {});
	// The app opens the library as it starts, before the landing screen.
	backend.state.libraryOpen = true;
	backend.dialogAnswers.push(PLACE);
	render(NewProject, { props: { open: true, onready } });
	return { user, onready };
}

async function named(user: ReturnType<typeof userEvent.setup>, name: string) {
	const field = screen.getByRole('textbox', { name: 'Name' });
	// The dialog puts focus on the name as it opens; typing before then races it.
	await vi.waitFor(() => expect(document.activeElement).toBe(field));
	await user.type(field, name);
	await user.click(screen.getByRole('button', { name: 'Choose…' }));
	await screen.findByText(PLACE);
}

describe('NewProject', () => {
	const backend = useFakeBackend();

	it('M1b-11 AC-1: makes a named folder in the chosen place and opens it, empty', async () => {
		const { user, onready } = setup(backend());
		await named(user, 'Thesis two');
		await user.click(screen.getByRole('button', { name: 'Create project' }));

		await waitFor(() => expect(onready).toHaveBeenCalledWith(`${PLACE}/Thesis two`, null, null));
		expect(backend().files.has(`${PLACE}/Thesis two/.erti/project.db`)).toBe(true);
	});

	it('M1b-11 AC-1: says why a name is refused, and makes nothing', async () => {
		const { user, onready } = setup(backend());
		await named(user, 'a/b');
		await user.click(screen.getByRole('button', { name: 'Create project' }));

		expect(await screen.findByText(/can’t have \/ \\ : \* \? " < > or \| in it/)).toBeVisible();
		expect(onready).not.toHaveBeenCalled();
	});

	it('M1b-11 AC-3, AC-5, AC-6: ticks a collection from Zotero, previews it, imports it with its PDFs', async () => {
		const { user, onready } = setup(backend());
		await named(user, 'From Zotero');
		await user.click(screen.getByRole('radio', { name: /From Zotero/ }));

		// Found where Zotero keeps it, and drawn as Zotero draws it.
		expect(await screen.findByRole('tree', { name: 'Zotero library' })).toBeVisible();
		expect(row('My Library')).toBeVisible();
		expect(row('Lab reading')).toBeVisible();

		row('Thesis').focus();
		await user.keyboard(' ');
		expect(row('Thesis')).toHaveAttribute('aria-checked', 'true');

		// Thesis and its Chapter 2: two works, two PDFs, one of Chapter 2's not downloaded.
		const summary = await screen.findByTestId('zotero-summary');
		expect(summary).toHaveTextContent('2 new works · 2 PDFs to attach · 1 PDF can’t be attached');

		await user.click(screen.getByRole('button', { name: 'Create project' }));
		await waitFor(() => expect(onready).toHaveBeenCalled());

		const [path, imported] = onready.mock.calls[0] as unknown as [
			string,
			{ added: string[]; attached: { path: string }[] }
		];
		expect(path).toBe(`${PLACE}/From Zotero`);
		expect(imported.added).toHaveLength(2);
		// Attached where Zotero keeps them: nothing copied into the project.
		expect(imported.attached.map((a) => a.path)).toEqual([
			'/fake/home/Zotero/storage/ATTACHB3/ostrom-1990.pdf',
			'/fake/home/Zotero/storage/ATTACHC4/fukuyama-1995.pdf'
		]);
		const state = backend().state;
		expect(state.root).toBe(path);
		expect(imported.added.every((id) => state.project.has(id))).toBe(true);
		// Kept in step by default: the project follows what was ticked.
		expect(state.zotero.follow).toEqual([
			{ library: 'user', kind: 'collection', key: 'THESIS22', name: 'Thesis' }
		]);
	});

	it('M1b-11 AC-6: an import that stops still opens the project, and says why there', async () => {
		const { user, onready } = setup(backend());
		await named(user, 'Stopped');
		await user.click(screen.getByRole('radio', { name: /From Zotero/ }));
		await screen.findByRole('tree', { name: 'Zotero library' });
		row('Thesis').focus();
		await user.keyboard(' ');
		await screen.findByTestId('zotero-summary');

		vi.mocked(db.importSources).mockRejectedValueOnce(new Error('The disk is full.'));
		await user.click(screen.getByRole('button', { name: 'Create project' }));
		await waitFor(() => expect(onready).toHaveBeenCalled());
		const [path, , failure] = onready.mock.calls[0] as unknown as [string, unknown, string];
		expect(path).toBe(`${PLACE}/Stopped`);
		// Said by the landing screen once the project is open: the dialog has gone.
		expect(failure).toBe('The disk is full.');
	});

	it('M1b-11 AC-4: a collection opened shows its papers, and one paper can be ticked', async () => {
		const { user } = setup(backend());
		await named(user, 'One paper');
		await user.click(screen.getByRole('radio', { name: /From Zotero/ }));
		await screen.findByRole('tree', { name: 'Zotero library' });

		await user.click(row('Methods'));
		await user.click(await screen.findByRole('treeitem', { name: /^Bowling Alone/ }));

		expect(row('Bowling Alone')).toHaveAttribute('aria-checked', 'true');
		// The only paper in Methods: the collection is ticked with it.
		expect(row('Methods')).toHaveAttribute('aria-checked', 'true');
		expect(row('My Library')).toHaveAttribute('aria-checked', 'mixed');
		expect(await screen.findByTestId('zotero-summary')).toHaveTextContent(
			'1 new work · 1 PDF to attach'
		);
	});
});

describe('NewProject without Zotero', () => {
	const backend = useFakeBackend(() => ({ ...defaultFixture(), zotero: null }));

	it('M1b-11 AC-2: says Zotero wasn’t found, and a folder without a library is refused', async () => {
		const { user } = setup(backend());
		await named(user, 'Elsewhere');
		await user.click(screen.getByRole('radio', { name: /From Zotero/ }));

		expect(await screen.findByText('Erti didn’t find Zotero on this computer.')).toBeVisible();
		backend().dialogAnswers.push('/fake/home/Documents');
		await user.click(screen.getByRole('button', { name: 'Locate Zotero data folder…' }));
		expect(await screen.findByText(/That folder has no Zotero library in it/)).toBeVisible();
	});
});
