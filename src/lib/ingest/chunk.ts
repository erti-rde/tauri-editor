/**
 * Structure-aware chunking.
 *
 * The previous pipeline ran `llm-chunk` over one flat string with
 * `minLength: 100` characters and no overlap. That produced chunks around a
 * tenth of the model's capacity, cut sentences at arbitrary boundaries with no
 * way to recover the context, indexed every paper's reference list, and recorded
 * nothing about where a chunk came from.
 *
 * Like `extract.ts`, this file avoids Tauri, Svelte and path aliases so the
 * retrieval benchmark measures exactly the code the app runs.
 */

import type { ExtractedPage, Line } from './extract';

export interface Chunk {
	text: string;
	/** 1-based page the chunk starts on. */
	pageStart: number;
	pageEnd: number;
	/** Nearest preceding heading, when one was found. */
	section: string | null;
	/** Offsets into the document text, for locating the passage later (#37). */
	charStart: number;
	charEnd: number;
}

export interface ChunkOptions {
	/**
	 * Target chunk size in characters.
	 *
	 * The bundled tokenizer truncates at 128 tokens and pads to that length, so
	 * roughly 500 characters is the point beyond which text is silently discarded.
	 * The default leaves headroom for the [CLS]/[SEP] tokens and for words that
	 * cost more than one token each.
	 */
	targetChars?: number;
	/** Fraction of the previous chunk repeated, so a match at a boundary survives. */
	overlap?: number;
	/** Drop the reference list. */
	excludeReferences?: boolean;
}

const DEFAULTS = {
	targetChars: 380,
	overlap: 0.15,
	excludeReferences: true
} satisfies Required<ChunkOptions>;

/** Headings that begin a reference list, in the forms journals actually use. */
const REFERENCES_HEADING =
	/^\s*(?:\d+\.?\s*)?(references|bibliography|works\s+cited|literature\s+cited|reference\s+list)\s*$/i;

/**
 * Whether a line looks like a section heading.
 *
 * Font size alone is unreliable — many papers set headings in the body size and
 * distinguish them by weight or numbering — so several signals are combined.
 */
export function isHeading(line: Line, bodyFontSize: number): boolean {
	const text = line.text.trim();
	if (text.length === 0 || text.length > 90) return false;

	// A line ending in sentence punctuation is prose, not a heading — including
	// an enumerated sentence like "1. We evaluate the model on three datasets."
	// A leading digit used to exempt such lines, which made them headings, and
	// heading text is never added to a segment: the sentence vanished from the
	// index entirely. Real numbered headings ("3.2 Experimental Setup") do not
	// end in punctuation, so no exemption is needed.
	if (/[.;,]$/.test(text)) return false;

	const larger = line.fontSize > bodyFontSize * 1.08;
	const numbered = /^\d+(\.\d+)*\.?\s+\S/.test(text) && text.split(/\s+/).length <= 12;
	const named =
		/^\s*(?:\d+\.?\s*)?(abstract|introduction|background|related work|method(s|ology)?|materials and methods|experiments?|results?|discussion|conclusions?|limitations|acknowledg(e)?ments?|appendix|references|bibliography)\s*$/i.test(
			text
		);
	const shortAllCaps = text.length < 40 && text === text.toUpperCase() && /[A-Z]{3}/.test(text);

	return larger || numbered || named || shortAllCaps;
}

/** The most common line height, taken as the body text size. */
function bodyFontSize(pages: ExtractedPage[]): number {
	const counts = new Map<number, number>();
	for (const page of pages) {
		for (const line of page.lines) {
			const rounded = Math.round(line.fontSize * 2) / 2;
			counts.set(rounded, (counts.get(rounded) ?? 0) + line.text.length);
		}
	}

	let best = 10;
	let bestWeight = 0;
	for (const [size, weight] of counts) {
		if (weight > bestWeight) {
			best = size;
			bestWeight = weight;
		}
	}
	return best;
}

interface Segment {
	text: string;
	section: string | null;
	pageStart: number;
	pageEnd: number;
	charStart: number;
}

/**
 * Flatten pages into contiguous runs of body text, each tagged with the heading
 * it sits under, stopping at the reference list.
 */
function segmentBySection(pages: ExtractedPage[], options: Required<ChunkOptions>): Segment[] {
	const body = bodyFontSize(pages);
	const segments: Segment[] = [];

	let current: Segment | null = null;
	let section: string | null = null;
	let offset = 0;
	// Set while inside the reference list, cleared at the next heading, so an
	// appendix printed after the references is still indexed.
	let inReferences = false;

	const flush = () => {
		if (current && current.text.trim().length > 0) segments.push(current);
		current = null;
	};

	for (const page of pages) {
		for (const line of page.lines) {
			const text = line.text.trim();
			if (text.length === 0) continue;

			if (isHeading(line, body)) {
				flush();
				// A reference list is dense with author names, titles and years, so
				// its chunks match anything citation-shaped. Skip its body, but
				// resume at the next heading rather than abandoning the document.
				inReferences = options.excludeReferences && REFERENCES_HEADING.test(text);
				section = inReferences ? null : text;
				offset += text.length + 1;
				continue;
			}

			if (inReferences) {
				offset += text.length + 1;
				continue;
			}

			if (current === null) {
				current = {
					text,
					section,
					pageStart: line.page,
					pageEnd: line.page,
					charStart: offset
				};
			} else {
				// Rejoin a word hyphenated across the line break.
				if (/[a-z]-$/.test(current.text) && /^[a-z]/.test(text)) {
					current.text = current.text.slice(0, -1) + text;
				} else {
					current.text += ' ' + text;
				}
				current.pageEnd = line.page;
			}
			offset += text.length + 1;
		}
	}

	flush();
	return segments;
}

/**
 * Split text into sentences.
 *
 * Deliberately conservative about abbreviations and initials, which are
 * everywhere in academic prose and would otherwise shatter sentences.
 */
export function splitSentences(text: string): string[] {
	// Periods that do not end a sentence are swapped for a sentinel, split on, then
	// restored — so "Smith et al. showed" and "J. R. R. Tolkien" stay whole without
	// losing their punctuation.
	const SENTINEL = '\u0000';

	const masked = text
		// Single-letter initials: "J. R. Smith".
		.replace(/\b([A-Z])\.(?=\s)/g, `$1${SENTINEL}`)
		// Abbreviations that are everywhere in academic prose.
		.replace(
			/\b(et al|e\.g|i\.e|cf|vs|Fig|Figs|Eq|Eqs|Tab|Ref|Refs|approx|ca|Dr|Prof|St|No|pp|vol)\.(?=\s)/gi,
			(match) => match.slice(0, -1) + SENTINEL
		)
		// Decimals: "explained 0.95 of the variance".
		.replace(/(\d)\.(?=\d)/g, `$1${SENTINEL}`);

	return masked
		.split(/(?<=[.!?])\s+(?=[A-Z(“"'])/)
		.map((sentence) => sentence.split(SENTINEL).join('.').trim())
		.filter((sentence) => sentence.length > 0);
}

/**
 * Pack sentences into chunks of roughly `targetChars`, repeating the tail of the
 * previous chunk so a passage spanning a boundary is still findable.
 */
function packSentences(segment: Segment, options: Required<ChunkOptions>): Chunk[] {
	const sentences = splitSentences(segment.text);
	if (sentences.length === 0) return [];

	const chunks: Chunk[] = [];
	let buffer: string[] = [];
	let bufferLength = 0;
	let charStart = segment.charStart;

	const emit = () => {
		const text = buffer.join(' ').trim();
		if (text.length === 0) return;

		chunks.push({
			text,
			pageStart: segment.pageStart,
			pageEnd: segment.pageEnd,
			section: segment.section,
			charStart,
			charEnd: charStart + text.length
		});

		// Carry the tail forward as overlap.
		const overlapChars = Math.floor(options.targetChars * options.overlap);
		const carried: string[] = [];
		let carriedLength = 0;
		for (let i = buffer.length - 1; i >= 0 && carriedLength < overlapChars; i--) {
			carried.unshift(buffer[i]);
			carriedLength += buffer[i].length + 1;
		}

		charStart += Math.max(1, text.length - carriedLength);
		buffer = carried;
		bufferLength = carriedLength;
	};

	for (const sentence of sentences) {
		// A single sentence longer than the target is emitted whole rather than
		// cut mid-clause; the tokenizer will truncate it, but the text stays
		// readable in the result list.
		if (bufferLength > 0 && bufferLength + sentence.length > options.targetChars) {
			emit();
		}
		buffer.push(sentence);
		bufferLength += sentence.length + 1;
	}

	if (buffer.length > 0) {
		const text = buffer.join(' ').trim();
		if (text.length > 0) {
			chunks.push({
				text,
				pageStart: segment.pageStart,
				pageEnd: segment.pageEnd,
				section: segment.section,
				charStart,
				charEnd: charStart + text.length
			});
		}
	}

	return chunks;
}

/**
 * Turn extracted pages into chunks ready for embedding.
 */
export function chunkPages(pages: ExtractedPage[], options: ChunkOptions = {}): Chunk[] {
	const merged = { ...DEFAULTS, ...options };

	// A mistyped CLI flag reaches here as NaN. Left unchecked it makes the emit
	// condition always false, so the document becomes one huge chunk that the
	// tokenizer silently truncates to its first 128 tokens. An overlap at or
	// above 1 makes consecutive chunks repeat the same text forever.
	const resolved = {
		...merged,
		targetChars:
			Number.isFinite(merged.targetChars) && merged.targetChars > 0
				? merged.targetChars
				: DEFAULTS.targetChars,
		overlap:
			Number.isFinite(merged.overlap) && merged.overlap >= 0 && merged.overlap < 0.9
				? merged.overlap
				: DEFAULTS.overlap
	};

	return segmentBySection(pages, resolved).flatMap((segment) => packSentences(segment, resolved));
}
