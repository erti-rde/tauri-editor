import * as pdfjsLib from 'pdfjs-dist';
// Resolve the worker from the same package as the library above, so the two can
// never drift apart. This previously pointed at a hand-copied worker in
// static/pdfjs-2/, which pdf.js rejects outright when the versions disagree.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';

/**
 * The one way the app opens a PDF (M6-3, SEC-5).
 *
 * Every PDF is somebody else's file, so pdf.js is told never to compile code
 * from one. With `isEvalSupported` on, pdf.js turns each embedded font's glyph
 * outlines into a function with `new Function` and draws with that: a bug in
 * what it wrote into the function is how CVE-2024-4367 ran a PDF's
 * JavaScript. The CSP refuses eval in the window too, but this doesn't lean
 * on the CSP being right. Glyphs are drawn from their outlines instead.
 *
 * A test fails if anything else in the app calls `getDocument`.
 */

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** What a caller may choose. The hardening isn't one of them. */
export type OpenPdfParameters = Omit<DocumentInitParameters, 'isEvalSupported'>;

export function openPdf(parameters: OpenPdfParameters) {
	return pdfjsLib.getDocument({ ...parameters, isEvalSupported: false });
}
