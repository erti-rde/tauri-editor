import type { AttributionMatches, MatchedPassage, Span } from '$lib/ipc';

import { words } from './normalise';

/**
 * What a span of shared words means (M4-4, ADR 006, docs/ux.md UX-7).
 *
 * The matcher finds where a sentence shares words with the corpus; this says
 * which of those a writer would want to know about, and why. The four kinds
 * are the four groups of the Check panel:
 *
 * - **uncited**: a source's words, with no citation in the sentence;
 * - **drifted_quote**: in quotation marks and cited to the right work, but the
 *   words differ from the source's;
 * - **wrong_source**: cited, but to a different work from the one it matches;
 * - **self_reuse**: the writer's words from another document in the project.
 *
 * Words cited to their source without quotation marks are not a finding: the
 * citation is there and points the right way (UX-7 has no group for them).
 * Stock phrasing, which many sources share, is not a finding either.
 *
 * Pure, and mutation-tested (M4-4 AC-3): its thresholds decide what a writer
 * is told, so a change that alters a verdict has to fail a test.
 */

export const FINDING_KINDS = ['uncited', 'drifted_quote', 'wrong_source', 'self_reuse'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** A sentence as the check sees it. */
export interface CheckedSentence {
	text: string;
	/** The works its citations name, by canonical id (ADR 003). */
	cites: readonly string[];
	/** Inside a block quotation, which quotes without quotation marks. */
	quoted: boolean;
}

export interface Thresholds {
	/** The fewest of a sentence's words a span must share to be reported. */
	minSharedWords: number;
	/** A shingle held by this many sources or more is common phrasing. */
	commonIn: number;
	/** A span whose shingles are at least this share common is stock phrasing. */
	commonShare: number;
}

/**
 * Chosen from the harness (`pnpm eval:attribution`), whose sweep is recorded
 * in `last-run.json`. At eight words, every combination of the other two (in
 * 3–10 sources, a share of a quarter to all) got 128 of the 129 labelled
 * sentences right; no other floor did. Seven and ten lose one sentence, six
 * up to three (runs of stock phrasing get through), twelve lose nine (short
 * uncited borrowings are missed). Five sources and a half are the middle of
 * their ranges, since the set is small and a library is not the fixture.
 */
export const THRESHOLDS: Thresholds = {
	minSharedWords: 8,
	commonIn: 5,
	commonShare: 0.5
};

export interface Finding {
	/** The sentence, by its index in what was checked. */
	sentence: number;
	kind: FindingKind;
	/** The work the words match, or the document they were reused from. */
	work: string;
	/** The span that shows it, its `passage` an index into the result's passages. */
	span: Span;
	passage: MatchedPassage;
}

/**
 * The order findings are worth reading in, worst first. A sentence cited to
 * the wrong work misleads a reader; a drifted quotation misquotes; an uncited
 * borrowing omits; reuse of one's own words is the mildest.
 */
const SEVERITY: readonly FindingKind[] = ['wrong_source', 'drifted_quote', 'uncited', 'self_reuse'];

/** What the check says of a sentence: its worst finding, or nothing. */
export function verdictOf(findings: readonly Pick<Finding, 'kind'>[]): FindingKind | 'none' {
	for (const kind of SEVERITY) if (findings.some((f) => f.kind === kind)) return kind;
	return 'none';
}

/* -------------------------------------------------------------- quotations */

/** Opening mark → the marks that close it. */
const CLOSERS: Record<string, string> = {
	'“': '”',
	'„': '“”',
	'«': '»',
	'‘': '’',
	'"': '"',
	"'": "'"
};
const CLOSING_DOUBLE = new Set(['”', '»']);
/** Single marks double as apostrophes, so they open and close only at a word's edge. */
const SINGLE = new Set(['‘', '’', "'"]);
const LETTER = /[\p{L}\p{N}]/u;

/**
 * Where a sentence quotes: the text inside each pair of quotation marks, as
 * `[start, end)` offsets.
 *
 * A closing mark with no opening one ends a quotation that began in an earlier
 * sentence, so the text before it is quoted. An opening mark that never closes
 * runs on into the next sentence, so the text after it is.
 */
export function quotations(text: string): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	const chars = Array.from(text);
	// Offsets in UTF-16 units, as `slice` takes them.
	const at: number[] = [];
	let offset = 0;
	for (const c of chars) {
		at.push(offset);
		offset += c.length;
	}
	at.push(offset);

	const letterAt = (i: number) => i >= 0 && i < chars.length && LETTER.test(chars[i]);
	let open: { mark: string; from: number } | null = null;

	for (let i = 0; i < chars.length; i++) {
		const c = chars[i];
		if (open) {
			const closes = CLOSERS[open.mark].includes(c);
			if (closes && !(SINGLE.has(c) && letterAt(i + 1))) {
				out.push([at[open.from], at[i]]);
				open = null;
			}
			continue;
		}
		if (c in CLOSERS && !(SINGLE.has(c) && letterAt(i - 1))) {
			open = { mark: c, from: i + 1 };
		} else if (CLOSING_DOUBLE.has(c) && out.length === 0) {
			// Closing a quotation from an earlier sentence. Only a double mark:
			// a lone ’ is far more often an apostrophe ("the models’ outputs").
			out.push([0, at[i]]);
		}
	}
	if (open) out.push([at[open.from], text.length]);
	// A pair of marks with nothing between quotes nothing.
	return out.filter(([start, end]) => start < end);
}

/** A quotation's words in the sentence, as a `[start, end)` range of words. */
function wordRange(text: string, [start, end]: [number, number]): [number, number] {
	const before = words(text.slice(0, start)).length;
	return [before, before + words(text.slice(start, end)).length];
}

/**
 * The parts of a quotation that must be the source's words: split where the
 * writer marked an omission (`…`, `...`, `[…]`) or inserted words of their
 * own (`[the model]`). A bracketed single letter is a changed capital
 * ("[t]he") and stays in its word.
 */
export function quotedParts(quote: string): string[][] {
	return quote
		.replace(/\[(\p{L})\]/gu, '$1')
		.split(/\[[^\]]*\]|…|\.\s*\.\s*\./u)
		.map(words)
		.filter((part) => part.length > 0);
}

/** Whether `parts` appear in `passage`, each unbroken, in order. */
export function quotedExactly(parts: string[][], passage: string[]): boolean {
	let from = 0;
	for (const part of parts) {
		const found = indexOfRun(passage, part, from);
		if (found < 0) return false;
		from = found + part.length;
	}
	return parts.length > 0;
}

function indexOfRun(haystack: string[], needle: string[], from: number): number {
	outer: for (let i = from; i + needle.length <= haystack.length; i++) {
		for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
		return i;
	}
	return -1;
}

/* ----------------------------------------------------------------- spans */

/** Whether most of a span's shingles are phrasing many sources share. */
export function isStock(span: Pick<Span, 'sources'>, thresholds: Thresholds): boolean {
	if (span.sources.length === 0) return false;
	const common = span.sources.filter((n) => n >= thresholds.commonIn).length;
	return common / span.sources.length >= thresholds.commonShare;
}

function overlap(a: readonly [number, number], b: readonly [number, number]): number {
	return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

/** Words of `range` that none of `covered` covers. */
function uncovered(
	range: readonly [number, number],
	covered: Array<readonly [number, number]>
): number {
	let count = 0;
	for (let w = range[0]; w < range[1]; w++) {
		if (!covered.some(([a, b]) => a <= w && w < b)) count++;
	}
	return count;
}

/** The span with the most shared words, the first of equals. */
function longest(spans: Span[]): Span {
	return spans.reduce((best, s) => (s.sharedWords > best.sharedWords ? s : best));
}

/* ------------------------------------------------------------- classify */

/**
 * Every finding, sentence by sentence.
 *
 * Spans from a cited work explain the words they cover, so a passage that two
 * works share is not reported against the one the writer didn't cite. What
 * no cited work explains is reported against the work it matches: as uncited
 * when the sentence cites nothing, otherwise as cited to the wrong work. The
 * writer's own other documents count only for words no source matches.
 */
export function classify(
	sentences: readonly CheckedSentence[],
	matches: AttributionMatches,
	thresholds: Thresholds = THRESHOLDS
): Finding[] {
	// Every span but stock phrasing. The floor on shared words applies only to
	// what's reported against a work the sentence doesn't cite: inside a
	// quotation of the cited work, one shingle is enough to compare the words,
	// and a drifted quotation rarely keeps more than that unbroken.
	const bySentence = new Map<number, Span[]>();
	for (const span of matches.spans) {
		if (isStock(span, thresholds)) continue;
		const list = bySentence.get(span.sentence) ?? [];
		list.push(span);
		bySentence.set(span.sentence, list);
	}

	const findings: Finding[] = [];
	const finding = (sentence: number, kind: FindingKind, span: Span): Finding => {
		const passage = matches.passages[span.passage];
		return { sentence, kind, work: passage.work, span, passage };
	};

	for (const [index, spans] of [...bySentence].sort(([a], [b]) => a - b)) {
		const sentence = sentences[index];
		if (!sentence) continue;
		const cited = new Set(sentence.cites);
		const passageOf = (span: Span) => matches.passages[span.passage];

		const fromSources = spans.filter((s) => passageOf(s).kind !== 'document');
		const fromCited = fromSources.filter((s) => cited.has(passageOf(s).work));
		const explained = fromCited.map((s) => s.sentenceWords);

		// Quoted and cited to the work it matches: are the words the source's?
		// Exact in any cited passage is exact. Chunks overlap, so the whole
		// quotation may sit in a neighbour; and if two cited works share it,
		// the writer has quoted one of them faithfully.
		const quotes = sentence.quoted
			? [[0, words(sentence.text).length] as [number, number]]
			: quotations(sentence.text).map((q) => wordRange(sentence.text, q));
		const quoteTexts = sentence.quoted
			? [sentence.text]
			: quotations(sentence.text).map(([a, b]) => sentence.text.slice(a, b));
		const drifted = new Set<string>();
		for (const span of fromCited) {
			const work = passageOf(span).work;
			quotes.forEach((range, q) => {
				if (overlap(range, span.sentenceWords) === 0) return;
				const parts = quotedParts(quoteTexts[q]);
				const exact = fromCited.some((s) => quotedExactly(parts, words(passageOf(s).text)));
				if (!exact && !drifted.has(work)) {
					drifted.add(work);
					findings.push(finding(index, 'drifted_quote', span));
				}
			});
		}

		// Matched to works the sentence doesn't cite, beyond what the cited explain.
		const others = new Map<string, Span[]>();
		for (const span of fromSources) {
			const work = passageOf(span).work;
			if (cited.has(work)) continue;
			if (span.sharedWords < thresholds.minSharedWords) continue;
			if (uncovered(span.sentenceWords, explained) < thresholds.minSharedWords) continue;
			others.set(work, [...(others.get(work) ?? []), span]);
		}
		for (const group of others.values()) {
			findings.push(finding(index, cited.size > 0 ? 'wrong_source' : 'uncited', longest(group)));
		}

		// The writer's own other documents, for the words no source explains.
		// A paper sharing six of them by chance doesn't make the rest any less
		// the writer's own. A source's span covers itself, so only documents'
		// spans get past this.
		const sourced = fromSources.map((s) => s.sentenceWords);
		const fromDocuments = new Map<string, Span[]>();
		for (const span of spans) {
			if (span.sharedWords < thresholds.minSharedWords) continue;
			if (uncovered(span.sentenceWords, sourced) < thresholds.minSharedWords) continue;
			const work = passageOf(span).work;
			fromDocuments.set(work, [...(fromDocuments.get(work) ?? []), span]);
		}
		for (const group of fromDocuments.values()) {
			findings.push(finding(index, 'self_reuse', longest(group)));
		}
	}

	return findings;
}
