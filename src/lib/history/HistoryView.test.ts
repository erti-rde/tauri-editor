import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import { chapterHistory, CUT_PARAGRAPH, MANUSCRIPT, ROOT, SHARED } from '$lib/harness/fixture';
import { nameFor, timeOfName } from '$lib/harness/fakeHistory';
import { useFakeBackend } from '$lib/harness/testing';
import { openLibrary, openProject } from '$lib/stores/db';
import { errorToast, successToast } from '$lib/ui/Toast.svelte';

import UiHarness from '$lib/ui/UiHarness.svelte';

import HistoryView from './HistoryView.svelte';
import { RESTORED, timeLabel } from './history';

/**
 * The History view (M5-1 AC-4, UX-9) on the fake backend, which keeps
 * snapshots as `history.rs` does. Chapter 1 has two in the fixture: three days
 * ago, and yesterday on close, holding a paragraph cut since.
 */

vi.mock('$lib/ui/Toast.svelte', () => ({ errorToast: vi.fn(), successToast: vi.fn() }));

const backend = useFakeBackend();

const chapter = {
	fileName: 'Chapter 1.erti.json',
	path: MANUSCRIPT,
	title: 'Chapter 1',
	legacy: false
};

async function show(document = chapter) {
	await openLibrary('/fake/home/Erti/library.db');
	await openProject(ROOT);
	const onclose = vi.fn();
	render(UiHarness, { props: { component: HistoryView, document, onclose } });
	await screen.findByRole('heading', { name: `History of ${document.title}` });
	return { onclose };
}

/** When the fixture's snapshot from yesterday was taken, as the list says it. */
function yesterdayAt() {
	const index = JSON.parse(backend().files.get(`${chapterHistory().dir}/snapshots.json`) as string);
	const [name] = Object.entries(index.snapshots).find(
		([, entry]) => (entry as { trigger: string }).trigger === 'close'
	)!;
	return timeLabel(timeOfName(name)!);
}

describe('the History view', () => {
	// M5-1 AC-4
	it('lists the snapshots by day, with their trigger and words, and previews the newest', async () => {
		await show();

		const yesterday = await screen.findByRole('region', { name: 'Yesterday' });
		const row = within(yesterday).getByRole('button', { name: /on close/ });
		expect(row).toHaveTextContent(`${yesterdayAt()} · on close · +30 words`);
		await waitFor(() => expect(row).toHaveAttribute('aria-pressed', 'true'));
		expect(screen.getByRole('button', { name: /while writing/ })).toHaveTextContent(
			/^\d\d:\d\d · while writing$/
		);

		expect(screen.getByText(`Yesterday, ${yesterdayAt()} · 57 words · read-only`)).toBeVisible();
		const preview = await screen.findByLabelText('The snapshot, read-only');
		expect(preview).toHaveTextContent(CUT_PARAGRAPH);
		expect(preview).toHaveAttribute('contenteditable', 'false');
		expect(screen.getByText(/^History uses \d+ KB$/)).toBeVisible();
	});

	// M5-1 AC-4
	it('shows another snapshot when it’s chosen, and changes nothing by looking', async () => {
		const user = userEvent.setup();
		await show();
		const before = backend().files.get(MANUSCRIPT);

		await user.click(await screen.findByRole('button', { name: /while writing/ }));
		await waitFor(() =>
			expect(screen.getByLabelText('The snapshot, read-only')).not.toHaveTextContent(CUT_PARAGRAPH)
		);
		expect(screen.getByRole('button', { name: /while writing/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(backend().files.get(MANUSCRIPT)).toBe(before);
	});

	// M5-1 AC-4, M5 Verify: restore yesterday's snapshot.
	it('restores a version after keeping the current one, and says so', async () => {
		const user = userEvent.setup();
		const { onclose } = await show();
		const today = backend().files.get(MANUSCRIPT);

		await user.click(await screen.findByRole('button', { name: 'Restore this version' }));

		await waitFor(() => expect(onclose).toHaveBeenCalled());
		expect(backend().files.get(MANUSCRIPT)).toContain(CUT_PARAGRAPH);
		expect(successToast).toHaveBeenCalledWith(RESTORED);
		// Today's version is the newest snapshot now, labelled with its words.
		const kept = [...backend().files]
			.filter(([path]) => path.startsWith(`${chapterHistory().dir}/2`))
			.sort(([a], [b]) => b.localeCompare(a))[0];
		expect(kept[1]).toBe(today);
		const index = JSON.parse(
			backend().files.get(`${chapterHistory().dir}/snapshots.json`) as string
		);
		expect(index.snapshots[kept[0].split('/').pop()!]).toEqual({
			trigger: 'before_restore',
			words: 39
		});
	});

	// M5-1 AC-4
	it('clears snapshots older than three months, once asked twice', async () => {
		const user = userEvent.setup();
		const old = nameFor(Math.floor(Date.now() / 1000) - 100 * 86_400);
		backend().files.set(`${chapterHistory().dir}/${old}`, '{"type":"doc","content":[]}');
		await show();

		await user.click(
			await screen.findByRole('button', { name: 'Clear snapshots older than 3 months' })
		);
		const dialog = await screen.findByRole('dialog', {
			name: 'Clear 1 snapshot older than 3 months?'
		});
		await user.click(within(dialog).getByRole('button', { name: 'Clear snapshots' }));

		await waitFor(() =>
			expect(screen.queryByRole('button', { name: /Clear snapshots older/ })).toBeNull()
		);
		expect(backend().files.has(`${chapterHistory().dir}/${old}`)).toBe(false);
		expect(screen.getAllByRole('button', { name: /^\d\d:\d\d/ })).toHaveLength(2);
	});

	it('offers nothing to clear when nothing is that old', async () => {
		await show();
		await screen.findByRole('region', { name: 'Yesterday' });
		expect(screen.queryByRole('button', { name: /Clear snapshots/ })).toBeNull();
	});

	it('says when a document has no snapshots yet', async () => {
		await show({ ...chapter, path: SHARED, title: 'Shared chapter' });
		expect(await screen.findByText('No snapshots of this document yet.')).toBeVisible();
		expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();
	});

	it('won’t restore a snapshot it can’t read, and says where it is', async () => {
		const damaged = nameFor(Math.floor(Date.now() / 1000) - 60);
		backend().files.set(`${chapterHistory().dir}/${damaged}`, '{"type":"doc","content":');
		await show();

		expect(await screen.findByText(new RegExp(`kept as ${damaged}`))).toBeVisible();
		expect(screen.getByRole('button', { name: 'Restore this version' })).toBeDisabled();
	});

	it('says when the history can’t be read', async () => {
		await openLibrary('/fake/home/Erti/library.db');
		await openProject(ROOT);
		render(UiHarness, {
			props: {
				component: HistoryView,
				document: { ...chapter, path: '/elsewhere/Theirs.erti.json', title: 'Theirs' },
				onclose: vi.fn()
			}
		});
		expect(
			await screen.findByText(/Could not read this document’s history: Erti can only open files/)
		).toBeVisible();
		expect(errorToast).not.toHaveBeenCalled();
	});
});
