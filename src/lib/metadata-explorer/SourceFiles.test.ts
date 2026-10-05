import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
	sourceFiles: vi.fn(),
	attachPdf: vi.fn(),
	revealItemInDir: vi.fn(),
	openTab: vi.fn(),
	errorToast: vi.fn(),
	retryIngest: vi.fn(async () => {})
}));
vi.mock('$lib/stores/db', () => ({ sourceFiles: mocks.sourceFiles }));
vi.mock('./attach', () => ({ attachPdf: mocks.attachPdf }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: mocks.revealItemInDir }));
vi.mock('$lib/workspace/workspaceStore', () => ({ workspaceStore: { open: mocks.openTab } }));
vi.mock('$lib/toast/Toast.svelte', () => ({ errorToast: mocks.errorToast }));
vi.mock('$utils/pdf_handlers', () => ({ retryIngest: mocks.retryIngest }));

import SourceFiles from './SourceFiles.svelte';

const PREPRINT = {
	sha256: 'pre',
	file_name: 'vaswani-preprint.pdf',
	path: '/papers/vaswani-preprint.pdf',
	found: true,
	state: 'ready',
	last_error: null
};
const PUBLISHED = {
	sha256: 'pub',
	file_name: 'vaswani-2017.pdf',
	path: '/old/vaswani-2017.pdf',
	found: false,
	state: 'ready',
	last_error: null
};

function show() {
	const onchange = vi.fn();
	const onopen = vi.fn();
	render(SourceFiles, { id: 'erti:paper', onchange, onopen });
	return { onchange, onopen };
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.sourceFiles.mockResolvedValue([PREPRINT, PUBLISHED]);
	mocks.attachPdf.mockResolvedValue(true);
});

describe('SourceFiles', () => {
	// M1b-7 AC-3
	it('shows where each file lives, or that it has moved', async () => {
		show();

		expect(await screen.findByText('/papers/vaswani-preprint.pdf')).toBeTruthy();
		expect(screen.getByText('File not found. Last seen at /old/vaswani-2017.pdf')).toBeTruthy();
		expect(mocks.sourceFiles).toHaveBeenCalledWith('erti:paper');
	});

	// M1b-7 AC-3
	it('opens a file in a tab, and shows it in its folder', async () => {
		const { onopen } = show();
		const [open] = await screen.findAllByRole('button', { name: 'Open' });

		await userEvent.click(open);
		expect(mocks.openTab).toHaveBeenCalledWith({
			id: '/papers/vaswani-preprint.pdf',
			kind: 'pdf',
			title: 'vaswani-preprint.pdf'
		});
		expect(onopen).toHaveBeenCalled();

		await userEvent.click(screen.getAllByRole('button', { name: 'Show in folder' })[0]);
		expect(mocks.revealItemInDir).toHaveBeenCalledWith('/papers/vaswani-preprint.pdf');
	});

	// M1b-7 AC-3
	it('offers neither for a file that can’t be found', async () => {
		show();
		const opens = await screen.findAllByRole('button', { name: 'Open' });
		const reveals = screen.getAllByRole('button', { name: 'Show in folder' });

		expect((opens[1] as HTMLButtonElement).disabled).toBe(true);
		expect((reveals[1] as HTMLButtonElement).disabled).toBe(true);
	});

	// M1b-7 AC-1
	it('says when a file is still being read, or could not be', async () => {
		mocks.sourceFiles.mockResolvedValue([
			{ ...PREPRINT, state: 'pending' },
			{ ...PUBLISHED, found: true, state: 'failed', last_error: 'No text' }
		]);
		show();

		expect(await screen.findByText('Reading…')).toBeTruthy();
		expect(screen.getByText('Couldn’t read it: No text')).toBeTruthy();
	});

	// M1b-7 AC-2
	it('attaches another file, and lists the files again', async () => {
		const { onchange } = show();
		mocks.attachPdf.mockImplementation(async (_work: string, changed: () => Promise<void>) => {
			mocks.sourceFiles.mockResolvedValue([PREPRINT, PUBLISHED, { ...PREPRINT, sha256: 'third' }]);
			await changed();
			return true;
		});

		await userEvent.click(await screen.findByRole('button', { name: 'Attach another…' }));

		expect(mocks.attachPdf).toHaveBeenCalledWith('erti:paper', expect.any(Function));
		expect(await screen.findAllByRole('button', { name: 'Open' })).toHaveLength(3);
		expect(onchange).toHaveBeenCalled();
	});

	// M1b-7 AC-1, M1b-5 AC-4
	it('offers Attach PDF… for a source with no file', async () => {
		mocks.sourceFiles.mockResolvedValue([]);
		show();

		expect(await screen.findByText('No file')).toBeTruthy();
		await userEvent.click(screen.getByRole('button', { name: 'Attach PDF…' }));
		expect(mocks.attachPdf).toHaveBeenCalledWith('erti:paper', expect.any(Function));
	});

	// M1b-7 AC-1: the table shows one file per source, so a second file that
	// failed has nowhere else to be retried.
	it('retries a file that couldn’t be read, under its own hash', async () => {
		mocks.sourceFiles.mockResolvedValue([
			PREPRINT,
			{ ...PUBLISHED, found: true, state: 'failed', last_error: 'No text' }
		]);
		const { onchange } = show();

		const retries = await screen.findAllByRole('button', { name: 'Retry' });
		expect(retries).toHaveLength(1);
		mocks.sourceFiles.mockResolvedValue([PREPRINT, { ...PUBLISHED, found: true }]);
		await userEvent.click(retries[0]);

		expect(mocks.retryIngest).toHaveBeenCalledWith({
			sha256: 'pub',
			path: '/old/vaswani-2017.pdf',
			file_name: 'vaswani-2017.pdf'
		});
		await waitFor(() => expect(screen.queryByText(/Couldn’t read it/)).toBeNull());
		expect(onchange).toHaveBeenCalled();
	});

	it('lists the files again when the table does, as a read finishes elsewhere', async () => {
		mocks.sourceFiles.mockResolvedValue([{ ...PREPRINT, state: 'pending' }]);
		const view = render(SourceFiles, {
			id: 'erti:paper',
			onchange: vi.fn(),
			onopen: vi.fn(),
			revision: 1
		});
		expect(await screen.findByText('Reading…')).toBeTruthy();

		mocks.sourceFiles.mockResolvedValue([PREPRINT]);
		await view.rerender({ id: 'erti:paper', onchange: vi.fn(), onopen: vi.fn(), revision: 2 });

		await waitFor(() => expect(screen.queryByText('Reading…')).toBeNull());
		expect(mocks.sourceFiles).toHaveBeenCalledTimes(2);
	});
});
