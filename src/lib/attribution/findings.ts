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
 * Where a drifted quotation and its source part ways: the runs of the
 * source's words the quotation doesn't have, as ranges of `source`.
 *
 * Read off a longest common subsequence, so a word changed at each end is
 * two places, not everything between. "eleven natural language tasks"
 * against "eleven natural language processing tasks" gives "processing".
 * Where the writer added a word the source hasn't, the source's words either
 * side of it stand for the place. Empty when the two agree.
 */
export function sourceDifferences(said: string[], source: string[]): Array<[number, number]> {
	// lcs[i][j]: the longest common run of said[i..] and source[j..].
	const lcs = Array.from({ length: said.length + 1 }, () =>
		new Array<number>(source.length + 1).fill(0)
	);
	for (let i = said.length - 1; i >= 0; i--) {
		for (let j = source.length - 1; j >= 0; j--) {
			lcs[i][j] =
				said[i] === source[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}

	const out: Array<[number, number]> = [];
	const add = (from: number, to: number) => {
		const last = out.at(-1);
		if (last && from <= last[1]) last[1] = Math.max(last[1], to);
		else out.push([from, to]);
	};
	let i = 0;
	let j = 0;
	while (i < said.length || j < source.length) {
		if (i < said.length && j < source.length && said[i] === source[j]) {
			i++;
			j++;
		} else if (j < source.length && (i === said.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
			add(j, j + 1);
			j++;
		} else {
			// A word of the writer's own. Where the source has words of its own
			// here too, that place is already named; otherwise its neighbours are.
			if (out.at(-1)?.[1] !== j) add(Math.max(0, j - 1), Math.min(source.length, j + 1));
			i++;
		}
	}
	return out.filter(([from, to]) => from < to);
}

/**
 * What the source says where a drifted quotation differs, as written: each
 * place, joined by an ellipsis. The whole quotation is compared, since the
 * drift is often just outside the words the matcher could pair up.
 */
export function sourceSays(sentence: CheckedSentence, span: Span, passage: MatchedPassage): string {
	const quotation = quotationOf(sentence, span);
	const quoted: [number, number] = quotation?.words ?? span.sentenceWords;
	const text =
		(quotation && sourceWordsFor(sentence.text, quotation.words, span, passage)) ??
		wordsAsWritten(passage.text, span.passageWords) ??
		passage.text;

	const places = sourceDifferences(words(sentence.text).slice(...quoted), words(text));
	if (places.length === 0) return text;
	return places.map((range) => wordsAsWritten(text, range) ?? '').join(' … ');
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

/** How far either side of where counting puts it a quotation's end is looked for. */
const SLACK = 4;

/**
 * The source's words for a whole drifted quotation: the passage words the
 * span aligns with, run out to the quotation's ends.
 *
 * Counting words out from the span puts each end where it would be if the
 * quotation kept the source's length; a word dropped or added outside the
 * span moves it. So each end is the quotation's own first or last word,
 * looked for near there, and the counted place when it isn't found.
 */
export function sourceWordsFor(
	sentence: string,
	quote: [number, number],
	span: Span,
	passage: MatchedPassage
): string | null {
	const said = words(sentence);
	const source = words(passage.text);
	const [s0, s1] = span.sentenceWords;
	const [p0, p1] = span.passageWords;

	const nearest = (word: string, target: number, lo: number, hi: number) => {
		let best: number | null = null;
		for (let k = Math.max(0, lo); k < Math.min(source.length, hi); k++) {
			if (source[k] === word && (best === null || Math.abs(k - target) < Math.abs(best - target)))
				best = k;
		}
		return best;
	};

	const counted = [p0 - (s0 - quote[0]), p1 + (quote[1] - s1)];
	const from =
		quote[0] < s0
			? (nearest(said[quote[0]], counted[0], counted[0] - SLACK, p0) ?? counted[0])
			: p0 + (quote[0] - s0);
	const last =
		quote[1] > s1
			? (nearest(said[quote[1] - 1], counted[1] - 1, p1, counted[1] + SLACK) ?? counted[1] - 1)
			: p1 - 1 - (s1 - quote[1]);
	return wordsAsWritten(passage.text, [Math.max(0, from), Math.min(source.length, last + 1)]);
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
