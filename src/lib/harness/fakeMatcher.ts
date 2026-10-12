import type { Span } from '$lib/ipc';
import { words } from '../attribution/normalise';

/**
 * `attribution::matcher` in TypeScript, for the fake backend (M4-3).
 *
 * The same shingles, runs, gaps and deduplication, so a journey that plants a
 * copied sentence gets the spans the app would. Strings stand in for hashes:
 * nothing here needs to be fast, only to agree.
 */

const SHINGLE = 6;
const MAX_GAP = 4;

interface Hit {
	sentence: number;
	atSentence: number;
	atPassage: number;
	shingle: string;
}

function shingles(text: string): string[] {
	const w = words(text);
	const out: string[] = [];
	for (let i = 0; i + SHINGLE <= w.length; i++) out.push(w.slice(i, i + SHINGLE).join(' '));
	return out;
}

export interface FakePassage {
	/** The work, for frequency and for deduplicating one work's overlapping chunks. */
	source: string;
	text: string;
}

/** Spans of `sentences` shared with `passages`, as `Matcher::finish` returns them. */
export function matchSpans(sentences: string[], passages: FakePassage[]): Span[] {
	const manuscript = new Map<string, Array<[number, number]>>();
	sentences.forEach((sentence, index) =>
		shingles(sentence).forEach((gram, at) => {
			const places = manuscript.get(gram) ?? [];
			places.push([index, at]);
			manuscript.set(gram, places);
		})
	);

	const seenIn = new Map<string, Set<string>>();
	const found: Array<{ source: string; span: Span; grams: string[] }> = [];

	passages.forEach((passage, index) => {
		const hits: Hit[] = [];
		shingles(passage.text).forEach((gram, atPassage) => {
			for (const [sentence, atSentence] of manuscript.get(gram) ?? []) {
				hits.push({ sentence, atSentence, atPassage, shingle: gram });
			}
		});
		for (const hit of hits) {
			const seen = seenIn.get(hit.shingle) ?? new Set();
			seen.add(passage.source);
			seenIn.set(hit.shingle, seen);
		}
		for (const [span, grams] of collapse(index, hits)) {
			found.push({ source: passage.source, span, grams });
		}
	});

	found.sort(
		(a, b) =>
			a.span.sentence - b.span.sentence ||
			(a.source < b.source ? -1 : a.source > b.source ? 1 : 0) ||
			b.span.sharedWords - a.span.sharedWords ||
			a.span.passage - b.span.passage
	);
	const kept: typeof found = [];
	for (const item of found) {
		const overlaps = kept.some(
			(k) =>
				k.span.sentence === item.span.sentence &&
				k.source === item.source &&
				k.span.sentenceWords[0] < item.span.sentenceWords[1] &&
				item.span.sentenceWords[0] < k.span.sentenceWords[1]
		);
		if (!overlaps) kept.push(item);
	}

	return kept
		.map(({ span, grams }) => ({
			...span,
			sources: grams.map((g) => seenIn.get(g)?.size ?? 0)
		}))
		.sort(
			(a, b) =>
				a.sentence - b.sentence || a.sentenceWords[0] - b.sentenceWords[0] || a.passage - b.passage
		);
}

function collapse(passage: number, hits: Hit[]): Array<[Span, string[]]> {
	const diagonal = (h: { atPassage: number; atSentence: number }) => h.atPassage - h.atSentence;
	hits.sort(
		(a, b) => a.sentence - b.sentence || diagonal(a) - diagonal(b) || a.atSentence - b.atSentence
	);

	type Run = { sentence: number; s: [number, number]; p: [number, number]; grams: string[] };
	const runs: Run[] = [];
	for (const hit of hits) {
		const run = runs.at(-1);
		if (
			run &&
			run.sentence === hit.sentence &&
			run.p[0] - run.s[0] === diagonal(hit) &&
			hit.atSentence <= run.s[1] - SHINGLE + 1
		) {
			run.s[1] = Math.max(run.s[1], hit.atSentence + SHINGLE);
			run.p[1] = Math.max(run.p[1], hit.atPassage + SHINGLE);
			run.grams.push(hit.shingle);
			continue;
		}
		runs.push({
			sentence: hit.sentence,
			s: [hit.atSentence, hit.atSentence + SHINGLE],
			p: [hit.atPassage, hit.atPassage + SHINGLE],
			grams: [hit.shingle]
		});
	}
	runs.sort((a, b) => a.sentence - b.sentence || a.s[0] - b.s[0] || a.p[0] - b.p[0]);

	const spans: Array<{ span: Span; grams: string[]; covered: Array<[number, number]> }> = [];
	for (const run of runs) {
		const last = spans.at(-1);
		if (
			last &&
			last.span.sentence === run.sentence &&
			run.s[0] <= last.span.sentenceWords[1] + MAX_GAP &&
			run.p[0] + MAX_GAP >= last.span.passageWords[0] &&
			run.p[0] <= last.span.passageWords[1] + MAX_GAP
		) {
			last.span.sentenceWords[1] = Math.max(last.span.sentenceWords[1], run.s[1]);
			last.span.passageWords[0] = Math.min(last.span.passageWords[0], run.p[0]);
			last.span.passageWords[1] = Math.max(last.span.passageWords[1], run.p[1]);
			last.grams.push(...run.grams);
			last.covered.push(run.s);
			continue;
		}
		spans.push({
			span: {
				sentence: run.sentence,
				passage,
				sentenceWords: [...run.s],
				passageWords: [...run.p],
				sharedWords: 0,
				verbatimScore: 0,
				sources: []
			},
			grams: [...run.grams],
			covered: [run.s]
		});
	}

	return spans.map(({ span, grams, covered }) => {
		const [start, end] = span.sentenceWords;
		let shared = 0;
		for (let w = start; w < end; w++) if (covered.some(([a, b]) => a <= w && w < b)) shared++;
		span.sharedWords = shared;
		span.verbatimScore = shared / (end - start);
		return [span, [...new Set(grams)].sort()];
	});
}

/**
 * Another manuscript's paragraphs, as `attribution::manuscript_paragraphs`
 * reads them: each text block, its apparatus and code left out.
 */
export function manuscriptParagraphs(doc: unknown): string[] {
	const SKIPPED = new Set(['bibliography', 'notes', 'citation', 'codeBlock']);
	type Node = { type?: unknown; text?: unknown; content?: unknown };
	const out: string[] = [];

	const walk = (node: Node) => {
		if (typeof node !== 'object' || node === null) return;
		if (SKIPPED.has(String(node.type))) return;
		if (!Array.isArray(node.content)) return;
		const children = node.content as Node[];
		if (!children.some((c) => c?.type === 'text')) {
			children.forEach(walk);
			return;
		}
		const text = children
			.map((c) => (c?.type === 'text' ? String(c.text ?? '') : c?.type === 'citation' ? '' : ' '))
			.join('')
			.trim();
		if (text) out.push(text);
	};

	walk(doc as Node);
	return out;
}
