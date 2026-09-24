import { extractPages, pagesToText, type Line } from '$lib/ingest/extract';

/**
 * One page's text, reconstructed the way the corpus was.
 *
 * Separate from `viewer.ts` because that module cannot be imported without
 * pdf.js's viewer components and a DOM to mount them in, and this is the part
 * worth testing against a real paper.
 *
 * It goes through `extractPages` rather than calling `getTextContent` and
 * joining the pieces, and that is the whole point. pdf.js emits positioned runs,
 * not words: joined naively they produce "theobserved effect", and a two-column
 * page comes out with the columns spliced line by line into each other. The
 * ingest pipeline already solves both, and the text behind `chunks` is its
 * output — so reading a page any other way would mean an annotation's offsets
 * and a chunk's offsets describing different strings.
 */

/** The part of a pdf.js document this needs. Duck-typed, as `extractPages` is. */
export interface PageSource {
	getPage(page: number): Promise<{
		getTextContent(): Promise<{ items: unknown[] }>;
		cleanup(): void;
	}>;
}

export async function pageTextFrom(doc: PageSource, page: number): Promise<string> {
	const pages = await extractPages({
		numPages: 1,
		getPage: () => doc.getPage(page)
	});

	return pagesToText(pages);
}

/** The same page, as positioned lines rather than a string. */
export async function pageLinesFrom(doc: PageSource, page: number): Promise<Line[]> {
	const pages = await extractPages({ numPages: 1, getPage: () => doc.getPage(page) });
	return pages[0]?.lines ?? [];
}
