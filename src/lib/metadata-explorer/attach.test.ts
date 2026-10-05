import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	open: vi.fn(),
	attachFile: vi.fn(),
	retryIngest: vi.fn(),
	errorToast: vi.fn(),
	successToast: vi.fn()
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('$lib/stores/db', () => ({ attachFile: mocks.attachFile }));
vi.mock('$utils/pdf_handlers', () => ({ retryIngest: mocks.retryIngest }));
vi.mock('$lib/toast/Toast.svelte', () => ({
	errorToast: mocks.errorToast,
	successToast: mocks.successToast
}));

import { IpcError } from '$lib/ipc';
import { attachPdf } from './attach';

const PATH = '/home/me/Downloads/ong.pdf';

beforeEach(() => {
	vi.clearAllMocks();
	mocks.open.mockResolvedValue(PATH);
	mocks.attachFile.mockResolvedValue({
		sha256: 'file-hash',
		file_name: 'ong.pdf',
		needs_ingest: true,
		merged: null
	});
	mocks.retryIngest.mockResolvedValue(undefined);
});

describe('attachPdf', () => {
	// M1b-7 AC-1
	it('picks a PDF, records it, and reads it under its own hash', async () => {
		const seen: string[] = [];
		const onchange = vi.fn(() => {
			seen.push(mocks.retryIngest.mock.calls.length ? 'after reading' : 'before reading');
		});

		expect(await attachPdf('erti:book', onchange)).toBe(true);

		expect(mocks.open).toHaveBeenCalledWith(
			expect.objectContaining({ filters: [{ name: 'PDF', extensions: ['pdf'] }] })
		);
		expect(mocks.attachFile).toHaveBeenCalledWith('erti:book', PATH);
		expect(mocks.retryIngest).toHaveBeenCalledWith({
			sha256: 'file-hash',
			path: PATH,
			file_name: 'ong.pdf'
		});
		// The row shows it pending, then follows it to ready.
		expect(seen).toEqual(['before reading', 'after reading']);
	});

	// M1b-7 AC-1
	it('lists the row again after a failed read, which ingest records', async () => {
		mocks.retryIngest.mockRejectedValue(new Error('No text'));
		const onchange = vi.fn();

		expect(await attachPdf('erti:book', onchange)).toBe(true);
		expect(onchange).toHaveBeenCalledTimes(2);
	});

	// M1b-7 AC-1
	it('does nothing when the picker is cancelled', async () => {
		mocks.open.mockResolvedValue(null);
		const onchange = vi.fn();

		expect(await attachPdf('erti:book', onchange)).toBe(false);
		expect(mocks.attachFile).not.toHaveBeenCalled();
		expect(onchange).not.toHaveBeenCalled();
	});

	// M1b-7 AC-1
	it('does not read again a PDF the library has read', async () => {
		mocks.attachFile.mockResolvedValue({
			sha256: 'file-hash',
			file_name: 'ong.pdf',
			needs_ingest: false,
			merged: null
		});
		const onchange = vi.fn();

		await attachPdf('erti:book', onchange);
		expect(mocks.retryIngest).not.toHaveBeenCalled();
		expect(onchange).toHaveBeenCalledTimes(1);
		expect(mocks.successToast).toHaveBeenCalledWith('Attached ong.pdf.');
	});

	// M1b-7 AC-1
	it('says so when the PDF was a source of its own', async () => {
		mocks.attachFile.mockResolvedValue({
			sha256: 'file-hash',
			file_name: 'ong.pdf',
			needs_ingest: false,
			merged: 'Orality & Literacy (scan)'
		});

		await attachPdf('erti:book', vi.fn());
		expect(mocks.successToast).toHaveBeenCalledWith(
			'ong.pdf was “Orality & Literacy (scan)” in your library. It’s now this source’s file, and its citations show this source.'
		);
	});

	// M1b-7 AC-1
	it('says why a PDF could not be attached', async () => {
		mocks.attachFile.mockRejectedValue(
			new IpcError({ kind: 'Conflict', message: 'That PDF is already attached to this source.' })
		);
		const onchange = vi.fn();

		expect(await attachPdf('erti:book', onchange)).toBe(false);
		expect(mocks.errorToast).toHaveBeenCalledWith(
			'Could not attach it: That PDF is already attached to this source.'
		);
		expect(onchange).not.toHaveBeenCalled();
	});
});
