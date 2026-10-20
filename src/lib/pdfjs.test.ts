import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openPdf, type OpenPdfParameters } from './pdfjs';

const getDocument = vi.hoisted(() => vi.fn(() => ({ promise: Promise.resolve({}) })));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.mjs' }));

beforeEach(() => getDocument.mockClear());

describe('opening a PDF', () => {
	it('M6-3 AC-1: never lets pdf.js compile code from it', () => {
		const data = new Uint8Array([37, 80, 68, 70]);
		openPdf({ data, cMapPacked: true });
		expect(getDocument).toHaveBeenCalledWith({ data, cMapPacked: true, isEvalSupported: false });
	});

	it('M6-3 AC-1: keeps eval off even when a caller asks for it', () => {
		// The type has no such option; this is the cast a caller would need.
		openPdf({ isEvalSupported: true } as OpenPdfParameters);
		expect(getDocument).toHaveBeenCalledWith({ isEvalSupported: false });
	});
});
