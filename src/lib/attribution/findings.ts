import type { MatchedPassage, Span } from '$lib/ipc';

import { quotations, type CheckedSentence, type Finding } from './classify';
import { normalise, wordSpans, words } from './normalise';
import type { Sentence } from './sentences';

/**
 * What the Check panel shows of a finding, and where a fix acts (M4-5, M4-6).
 *
 * Pure: the classifier says what a span means; this says which words of the
 * sentence and the passage it covers, as text the writer can read and offsets
 * a fix can act on.
 */

/** A sentence as the classifier reads it: its citations by canonical id (ADR 003). */
export function toChecked(
	sentence: Sentence,
	canonicalId: (id: string) => string
): CheckedSentence {
	return {
		text: sentence.text,
		cites: [...new Set(sentence.citations.flatMap((c) => c.ids.map(canonicalId)))],
		quoted: sentence.quoted
	};
}

/** Whether any sentence is long enough to share a shingle with anything (M4-3). */
export function anyLongEnough(sentences: readonly { text: string }[], shingle = 6): boolean {
	return sentences.some((s) => words(s.text).length >= shingle);
}

/**
 * Where a range of words is in `text`, as `[start, end)` offsets, or null when
 * the offsets can't be trusted (the per-character reading disagreed with the
 * whole-text one, which the fixture never shows but a fix must not guess on).
 */
export function wordOffsets(
	text: string,
	[from, to]: readonly [number, number]
): [number, number] | null {
	const spans = wordSpans(text);
	const expected = words(text);
	if (spans.length !== expected.length || spans.some((s, i) => s.word !== expected[i])) return null;
	if (from < 0 || to > spans.length || from >= to) return null;
	return [spans[from].start, spans[to - 1].end];
}

/** The words of `text` in a word range, as written. */
export function wordsAsWritten(text: string, range: readonly [number, number]): string | null {
	const at = wordOffsets(text, range);
	return at ? text.slice(at[0], at[1]) : null;
}

/**
 * The part of a sentence a finding is about, for the panel's two lines: the
 * matched words, with an ellipsis where the sentence goes on either side.
 */
export function excerpt(text: string, range: readonly [number, number]): string {
	const at = wordOffsets(text, range);
	if (!at) return text;
	const before = text.slice(0, at[0]).trim().length > 0 ? '…' : '';
	const after = /[\p{L}\p{N}]/u.test(text.slice(at[1])) ? '…' : '';
	return `${before}${text.slice(at[0], at[1])}${after}`;
}

/**
 * Where a drifted quotation and its source part ways: the source's words
 * between what they share at the start and at the end of the span.
 *
 * "eleven natural language tasks" against "eleven natural language processing
 * tasks" gives "processing". Null when the span holds no difference: then the
 * quotation differs outside it, and the span's own words are the best answer.
 */
export function sourceDifference(
	sentenceWords: string[],
	passageWords: string[]
): [number, number] | null {
	let head = 0;
	while (
		head < sentenceWords.length &&
		head < passageWords.length &&
		sentenceWords[head] === passageWords[head]
	)
		head++;
	let tail = 0;
	while (
		tail < sentenceWords.length - head &&
		tail < passageWords.length - head &&
		sentenceWords[sentenceWords.length - 1 - tail] === passageWords[passageWords.length - 1 - tail]
	)
		tail++;
	const end = passageWords.length - tail;
	if (head === sentenceWords.length && end === head) return null;
	// A word left out of the quotation: show the words around the gap.
	if (end === head) return [Math.max(0, head - 1), Math.min(passageWords.length, head + 1)];
	return [head, end];
}

/** What the source says where a drifted quotation differs, as written. */
export function sourceSays(sentence: string, span: Span, passage: MatchedPassage): string {
	const said = words(sentence).slice(...span.sentenceWords);
	const source = words(passage.text).slice(...span.passageWords);
	const diff = sourceDifference(said, source);
	const range: [number, number] = diff
		? [span.passageWords[0] + diff[0], span.passageWords[0] + diff[1]]
		: span.passageWords;
	return wordsAsWritten(passage.text, range) ?? source.join(' ');
}

/**
 * The quotation in the sentence a drifted finding is about, as `[start, end)`
 * offsets of the text inside its marks, with the words of it.
 */
export function quotationOf(
	sentence: CheckedSentence,
	span: Span
): { at: [number, number]; words: [number, number] } | null {
	if (sentence.quoted) return null;
	for (const at of quotations(sentence.text)) {
		const before = words(sentence.text.slice(0, at[0])).length;
		const range: [number, number] = [before, before + words(sentence.text.slice(...at)).length];
		if (Math.min(range[1], span.sentenceWords[1]) > Math.max(range[0], span.sentenceWords[0])) {
			return { at, words: range };
		}
	}
	return null;
}

/**
 * The source's words for a whole drifted quotation: the passage words the
 * span aligns with, run out to the quotation's ends.
 */
export function sourceWordsFor(
	quote: [number, number],
	span: Span,
	passage: MatchedPassage
): string | null {
	const total = words(passage.text).length;
	const from = Math.max(0, span.passageWords[0] - (span.sentenceWords[0] - quote[0]));
	const to = Math.min(total, span.passageWords[1] + (quote[1] - span.sentenceWords[1]));
	return wordsAsWritten(passage.text, [from, to]);
}

/** A finding's identity within one check: its sentence, kind and work. */
export function findingId(finding: Pick<Finding, 'sentence' | 'kind' | 'work'>): string {
	return `${finding.sentence}:${finding.kind}:${finding.work}`;
}

/**
 * What a dismissal is keyed by (M4-7 AC-2): the sentence's words, so spacing
 * and punctuation don't bring a finding back and changed words do.
 */
export async function sentenceHash(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(normalise(text));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface CslName {
	family?: string;
	given?: string;
	literal?: string;
}

/**
 * A work as a finding names it: "Vaswani et al. 2017", from its CSL. The
 * title stands in when there are no authors; null when there's neither.
 */
export function shortName(cslJson: string | null | undefined): string | null {
	if (!cslJson) return null;
	let csl: {
		author?: CslName[];
		editor?: CslName[];
		title?: unknown;
		issued?: { 'date-parts'?: unknown[][] };
	};
	try {
		csl = JSON.parse(cslJson);
	} catch {
		return null;
	}
	const year = csl?.issued?.['date-parts']?.[0]?.[0];
	const people = csl?.author?.length ? csl.author : (csl?.editor ?? []);
	const nameOf = (p: CslName) => p.family ?? p.literal ?? p.given ?? '';
	const names = people.map(nameOf).filter(Boolean);
	let who: string | null = null;
	if (names.length === 1) who = names[0];
	else if (names.length === 2) who = `${names[0]} and ${names[1]}`;
	else if (names.length > 2) who = `${names[0]} et al.`;
	if (!who) who = typeof csl?.title === 'string' && csl.title.trim() ? csl.title.trim() : null;
	if (!who) return null;
	return typeof year === 'number' || typeof year === 'string' ? `${who} ${year}` : who;
}

/** The page a passage is on, as the paper prints it when that's known. */
export function pageOf(passage: MatchedPassage): string | null {
	return passage.pageLabel ?? (passage.page ? String(passage.page) : null);
}
