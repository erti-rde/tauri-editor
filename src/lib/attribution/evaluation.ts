/**
 * The attribution harness (M4-1): a labelled set of manuscript sentences, the
 * corpus they were written against, and a confusion matrix of what a check
 * said about each against what it should have said.
 *
 * Built before the check itself (ADR 006), so the thresholds M4-4 chooses are
 * chosen from numbers rather than from the handful of sentences someone
 * happened to try. `pnpm eval:attribution` runs it; see
 * `tests/fixtures/attribution/README.md` for the set and how it was labelled.
 *
 * Nothing here ships. It sits beside the check so the two are typechecked and
 * tested together. Node runs it with `scripts/eval/resolve-ts.mjs`, which lets
 * the imports below leave off their `.ts` as the app's do.
 */

import type { MatchedPassage, Span } from '$lib/ipc';

import { classify, verdictOf, type Thresholds } from './classify';

/* ---------------------------------------------------------------- the labels */

/** What the check can report about a sentence: the four groups of UX-7. */
export const KINDS = ['uncited', 'drifted_quote', 'wrong_source', 'self_reuse'] as const;
export type Kind = (typeof KINDS)[number];

/** A kind, or nothing to report. */
export type Verdict = Kind | 'none';
export const VERDICTS: readonly Verdict[] = ['none', ...KINDS];

/** How a sentence came to be written, which decides what it should be told. */
export const CATEGORIES = [
	'verbatim_uncited',
	'verbatim_cited_unquoted',
	'quoted_cited_exact',
	'drifted_quote',
	'wrong_source',
	'self_reuse',
	'stock_phrase',
	'clean_paraphrase',
	'pdf_artefact'
] as const;
export type Category = (typeof CATEGORIES)[number];

/** The categories whose sentences carry a source's words. */
const COPIED: ReadonlySet<Category> = new Set([
	'verbatim_uncited',
	'verbatim_cited_unquoted',
	'quoted_cited_exact',
	'wrong_source',
	'self_reuse',
	'pdf_artefact'
]);

/** The categories whose sentences quote. */
const QUOTED: ReadonlySet<Category> = new Set(['quoted_cited_exact', 'drifted_quote']);

export interface LabelledSentence {
	id: string;
	category: Category;
	/** What the check should report. */
	expect: Verdict;
	/** The sentence as the writer has it, quotation marks and all. */
	text: string;
	/** The works its citations name, by canonical id (ADR 003). */
	cites: string[];
	/**
	 * Where its words come from: a corpus paper's id, `note:<id>` or
	 * `doc:<id>`. For a paraphrase, the paper paraphrased.
	 */
	from?: string;
	/**
	 * The source's words as the sentence carries them, each part a run found
	 * in both. Several parts when a quotation leaves words out. For a drifted
	 * quotation, the source's words before they drifted.
	 */
	copied?: string | string[];
	/** For text the extractor mangled: the words exactly as the corpus has them. */
	as_extracted?: string;
	/** For a paraphrase: the source sentence it restates. */
	paraphrases?: string;
	/** For a stock phrase: the phrase, which must be in at least ten sources. */
	stock?: string;
	why?: string;
}

export interface FixtureNote {
	id: string;
	source: string;
	kind: 'source_note' | 'mark';
	page?: string;
	quote: string;
	body: string;
}

export interface FixtureDocument {
	id: string;
	title: string;
	text: string;
}

export interface FixtureSource {
	id: string;
	title: string;
	/** Present for a source whose text the fixture supplies. */
	text?: string;
}

export interface Fixture {
	/** No-file sources, and the fixture's own sources for stock phrasing. */
	sources: FixtureSource[];
	notes: FixtureNote[];
	/** The project's other manuscripts. */
	documents: FixtureDocument[];
	sentences: LabelledSentence[];
}

/** A run of text the check reads: a chunk, a note's quote, another document. */
export interface Passage {
	/** The source it belongs to, or `doc:<id>` for another document. */
	source: string;
	kind: 'chunk' | 'note' | 'document';
	text: string;
}

export interface Chunk {
	source: string;
	text: string;
}

/** Everything a check reads: the corpus streamed past the manuscript. */
export function passagesFrom(chunks: Chunk[], fixture: Fixture): Passage[] {
	return [
		...chunks.map(({ source, text }) => ({ source, kind: 'chunk' as const, text })),
		...fixture.sources
			.filter((source) => source.text)
			.map((source) => ({ source: source.id, kind: 'chunk' as const, text: source.text! })),
		...fixture.notes.map((note) => ({
			source: note.source,
			kind: 'note' as const,
			text: note.quote
		})),
		...fixture.documents.map((doc) => ({
			source: `doc:${doc.id}`,
			kind: 'document' as const,
			text: doc.text
		}))
	];
}

/* ------------------------------------------------------- checking the labels */

/**
 * Words, loosely: enough to tell whether a sentence's words are really where
 * its label says. Not the check's normalisation (M4-3); this only has to be
 * right about the fixture, and errs towards refusing it.
 */
export function looseWords(text: string): string[] {
	return text
		.normalize('NFKC')
		.replace(/\u00AD/g, '')
		.replace(/(\p{L})- (\p{Ll})/gu, '$1$2')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

function contains(haystack: string[], needle: string[]): boolean {
	if (needle.length === 0) return false;
	outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
		for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
		return true;
	}
	return false;
}

function grams(words: string[], n: number): Set<string> {
	const out = new Set<string>();
	for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
	return out;
}

const parts = (copied: string | string[] | undefined): string[] =>
	copied === undefined ? [] : Array.isArray(copied) ? copied : [copied];

const QUOTE_MARKS = /[“”"]/;

/** The categories whose sentences cite the work their words come from. */
const CITES_ITS_SOURCE: ReadonlySet<Category> = new Set([
	'verbatim_cited_unquoted',
	'quoted_cited_exact',
	'drifted_quote'
]);

/**
 * Which version of the labelled set a result was measured on: a hash of the
 * whole fixture, so last-run.json can be told apart from a set edited since
 * without anyone remembering to run it again. FNV-1a, which needs no imports.
 */
export function fixtureFingerprint(fixture: Fixture): string {
	let hash = 0x811c9dc5;
	for (const unit of JSON.stringify(fixture)) {
		hash ^= unit.codePointAt(0)!;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

/**
 * What's wrong with the labels, without the corpus: each problem a line.
 *
 * `corpusIds` are the papers of the retrieval corpus; a citation or a `from`
 * naming anything else must name a fixture source, note or document.
 */
export function checkLabels(fixture: Fixture, corpusIds: Iterable<string>): string[] {
	const problems: string[] = [];
	const known = new Set([...corpusIds, ...fixture.sources.map((s) => s.id)]);
	const notes = new Map(fixture.notes.map((n) => [n.id, n]));
	const documents = new Map(fixture.documents.map((d) => [d.id, d]));
	const seen = new Set<string>();

	for (const note of fixture.notes)
		if (!known.has(note.source)) problems.push(`note ${note.id}: unknown source ${note.source}`);

	for (const s of fixture.sentences) {
		const say = (problem: string) => problems.push(`${s.id}: ${problem}`);
		if (seen.has(s.id)) say('duplicate id');
		seen.add(s.id);
		if (!CATEGORIES.includes(s.category)) say(`unknown category ${s.category}`);
		if (!VERDICTS.includes(s.expect)) say(`unknown verdict ${s.expect}`);
		for (const cite of s.cites) if (!known.has(cite)) say(`cites unknown source ${cite}`);

		if (QUOTED.has(s.category) && !QUOTE_MARKS.test(s.text)) say('should quote, and does not');

		if (s.from?.startsWith('note:')) {
			if (!notes.has(s.from.slice(5))) say(`no ${s.from}`);
		} else if (s.from?.startsWith('doc:')) {
			if (!documents.has(s.from.slice(4))) say(`no ${s.from}`);
		} else if (s.from && !known.has(s.from)) say(`from unknown ${s.from}`);

		// The work the words belong to, which is what a citation of them names.
		// Another document is the writer's own, so nothing cites it.
		const work = s.from?.startsWith('note:')
			? notes.get(s.from.slice(5))?.source
			: s.from?.startsWith('doc:')
				? undefined
				: s.from;
		if (s.expect === 'uncited' && s.cites.length > 0) say('labelled uncited, but cites');
		if (CITES_ITS_SOURCE.has(s.category) && work && !s.cites.includes(work))
			say(`should cite ${work}, and does not`);
		if (s.category === 'wrong_source') {
			if (s.cites.length === 0) say('a wrong-source citation needs a citation');
			else if (work && s.cites.includes(work)) say(`cites ${work}, its right source`);
		}

		const copied = parts(s.copied);
		if (COPIED.has(s.category)) {
			if (!s.from) say('copied, but from nowhere');
			if (copied.length === 0) say('copied, but says no words');
			for (const part of copied) if (!s.text.includes(part)) say(`does not carry "${part}"`);
		}

		if (s.category === 'drifted_quote') {
			if (copied.length !== 1) say('a drifted quotation needs the words it drifted from');
			else if (contains(looseWords(s.text), looseWords(copied[0])))
				say('carries the source words exactly, so has not drifted');
		}

		const origin = s.from?.startsWith('note:')
			? notes.get(s.from.slice(5))?.quote
			: s.from?.startsWith('doc:')
				? documents.get(s.from.slice(4))?.text
				: undefined;
		if (origin !== undefined)
			for (const part of copied)
				if (!contains(looseWords(origin), looseWords(part))) say(`${s.from} lacks "${part}"`);

		if (s.category === 'clean_paraphrase') {
			if (!s.paraphrases) say('a paraphrase needs the sentence it restates');
			else {
				const shared = [...grams(looseWords(s.text), 4)].filter((g) =>
					grams(looseWords(s.paraphrases!), 4).has(g)
				);
				if (shared.length > 0) say(`shares "${shared[0]}" with what it paraphrases`);
			}
		}

		if (s.category === 'stock_phrase') {
			if (!s.stock) say('a stock phrase needs the phrase');
			else if (!s.text.toLowerCase().includes(s.stock.toLowerCase()))
				say(`does not carry "${s.stock}"`);
			if (s.cites.length > 0) say('a stock phrase is tested uncited');
		}
	}
	return problems;
}

/**
 * What's wrong with the labels against the corpus itself: copied words that
 * aren't in the paper named, mangled text that isn't as mangled as claimed,
 * stock phrases in fewer than ten sources.
 *
 * This is what notices when a change to extraction or chunking moves the
 * corpus out from under the labels.
 */
export function checkAgainstCorpus(fixture: Fixture, passages: Passage[]): string[] {
	const problems: string[] = [];
	const bySource = new Map<string, { raw: string[]; words: string[][] }>();
	for (const p of passages) {
		const entry = bySource.get(p.source) ?? { raw: [], words: [] };
		entry.raw.push(p.text);
		entry.words.push(looseWords(p.text));
		bySource.set(p.source, entry);
	}
	const inSource = (source: string, words: string[]) =>
		bySource.get(source)?.words.some((w) => contains(w, words)) ?? false;

	for (const s of fixture.sentences) {
		const say = (problem: string) => problems.push(`${s.id}: ${problem}`);
		if (!s.from || s.from.includes(':')) {
			// Notes and documents were checked with the labels.
		} else if (!bySource.has(s.from)) {
			say(`no text for ${s.from}`);
			continue;
		} else if (s.as_extracted !== undefined) {
			if (!bySource.get(s.from)!.raw.some((text) => text.includes(s.as_extracted!)))
				say(`${s.from} does not have "${s.as_extracted}" as extracted`);
		} else {
			for (const part of parts(s.copied))
				if (!inSource(s.from, looseWords(part))) say(`${s.from} lacks "${part}"`);
		}
		if (s.paraphrases && s.from && !inSource(s.from, looseWords(s.paraphrases)))
			say(`${s.from} lacks the sentence paraphrased`);

		if (s.stock) {
			const phrase = looseWords(s.stock);
			const sources = [...bySource].filter(([, { words }]) =>
				words.some((w) => contains(w, phrase))
			);
			if (sources.length < 10) say(`"${s.stock}" is in ${sources.length} sources, not 10`);
		}
	}
	return problems;
}

/* ---------------------------------------------------------------- the scores */

export interface CategoryScore {
	n: number;
	/** How many the check put under each verdict: the row of the matrix. */
	got: Record<Verdict, number>;
	right: number;
}

export interface KindScore {
	/** Sentences labelled this kind. */
	labelled: number;
	/** Sentences the check reported as this kind. */
	reported: number;
	/** Reported as this kind, and labelled it. */
	right: number;
	/** Of those reported, how many were right; null with none reported. */
	precision: number | null;
	/** Of those labelled, how many were reported; null with none labelled. */
	recall: number | null;
}

export interface Report {
	checker: string;
	sentences: number;
	categories: Record<Category, CategoryScore>;
	kinds: Record<Kind, KindScore>;
	/** Every sentence the check got wrong. */
	wrong: { id: string; category: Category; expected: Verdict; got: Verdict }[];
}

const tally = (): Record<Verdict, number> =>
	Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;

const ratio = (part: number, whole: number) =>
	whole === 0 ? null : Number((part / whole).toFixed(3));

/** Score a check's verdicts against the labels. A sentence it said nothing of is "none". */
export function score(
	checker: string,
	sentences: LabelledSentence[],
	verdicts: ReadonlyMap<string, Verdict>
): Report {
	const categories = Object.fromEntries(
		CATEGORIES.map((c) => [c, { n: 0, got: tally(), right: 0 }])
	) as Record<Category, CategoryScore>;
	const wrong: Report['wrong'] = [];

	for (const s of sentences) {
		const got = verdicts.get(s.id) ?? 'none';
		const row = categories[s.category];
		row.n++;
		row.got[got]++;
		if (got === s.expect) row.right++;
		else wrong.push({ id: s.id, category: s.category, expected: s.expect, got });
	}

	const kinds = Object.fromEntries(
		KINDS.map((kind) => {
			const labelled = sentences.filter((s) => s.expect === kind);
			const reported = sentences.filter((s) => (verdicts.get(s.id) ?? 'none') === kind);
			const right = reported.filter((s) => s.expect === kind).length;
			return [
				kind,
				{
					labelled: labelled.length,
					reported: reported.length,
					right,
					precision: ratio(right, reported.length),
					recall: ratio(right, labelled.length)
				}
			];
		})
	) as Record<Kind, KindScore>;

	return { checker, sentences: sentences.length, categories, kinds, wrong };
}

const SHORT: Record<Verdict, string> = {
	none: 'none',
	uncited: 'uncited',
	drifted_quote: 'drifted',
	wrong_source: 'wrong src',
	self_reuse: 'self'
};

const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(0)}%`);

/** The report as the terminal shows it: the matrix by category, then each kind. */
export function formatReport(report: Report): string {
	const pad = (text: string | number, width: number) => String(text).padStart(width);
	const lines = [
		`Attribution check: ${report.checker}, ${report.sentences} labelled sentences`,
		'',
		`${'category'.padEnd(24)}${pad('n', 4)}${VERDICTS.map((v) => pad(SHORT[v], 10)).join('')}${pad('right', 8)}`
	];
	for (const category of CATEGORIES) {
		const row = report.categories[category];
		lines.push(
			`${category.padEnd(24)}${pad(row.n, 4)}${VERDICTS.map((v) => pad(row.got[v], 10)).join('')}${pad(`${row.right}/${row.n}`, 8)}`
		);
	}
	lines.push(
		'',
		`${'kind'.padEnd(24)}${pad('labelled', 10)}${pad('reported', 10)}${pad('right', 8)}${pad('precision', 11)}${pad('recall', 8)}`
	);
	for (const kind of KINDS) {
		const k = report.kinds[kind];
		lines.push(
			`${kind.padEnd(24)}${pad(k.labelled, 10)}${pad(k.reported, 10)}${pad(k.right, 8)}${pad(percent(k.precision), 11)}${pad(percent(k.recall), 8)}`
		);
	}
	if (report.wrong.length > 0) {
		lines.push('', `wrong (${report.wrong.length}):`);
		for (const w of report.wrong)
			lines.push(
				`  ${w.id.padEnd(8)} ${w.category.padEnd(24)} expected ${w.expected}, got ${w.got}`
			);
	}
	return lines.join('\n');
}

/* --------------------------------------------------------------- a baseline */

/**
 * The check anyone would write first, for the real one to beat: a sentence
 * matches the passage sharing most of its six-word runs, where words are only
 * lower-cased and split at punctuation. No discount for common phrasing, no
 * repair of what extraction mangled, and a quotation is exact or it isn't.
 *
 * It stands in until M4-3 and M4-4 exist, and afterwards is what their
 * numbers are compared against.
 */
export function baselineCheck(
	sentences: Pick<LabelledSentence, 'id' | 'text' | 'cites'>[],
	passages: Passage[]
): Map<string, Verdict> {
	const N = 6;
	const naive = (text: string) =>
		text
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter(Boolean);

	// The manuscript is indexed and the corpus streamed past it (ADR 006).
	const index = new Map<string, number[]>();
	sentences.forEach((s, i) => {
		for (const gram of grams(naive(s.text), N)) {
			const at = index.get(gram) ?? [];
			at.push(i);
			index.set(gram, at);
		}
	});
	const best: { passage: number; shared: number }[] = sentences.map(() => ({
		passage: -1,
		shared: 0
	}));
	const words = passages.map((p) => naive(p.text));
	passages.forEach((_, pi) => {
		const hits = new Map<number, number>();
		for (const gram of grams(words[pi], N))
			for (const si of index.get(gram) ?? []) hits.set(si, (hits.get(si) ?? 0) + 1);
		for (const [si, shared] of hits)
			if (shared > best[si].shared) best[si] = { passage: pi, shared };
	});

	const verdicts = new Map<string, Verdict>();
	sentences.forEach((s, i) => {
		const match = best[i].passage === -1 ? null : passages[best[i].passage];
		if (!match) return verdicts.set(s.id, 'none');
		if (match.kind === 'document') return verdicts.set(s.id, 'self_reuse');

		const quoted = [...s.text.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => naive(m[1]));
		if (quoted.length > 0) {
			const exact = quoted.every((q) =>
				passages.some((p, pi) => s.cites.includes(p.source) && contains(words[pi], q))
			);
			if (exact) return verdicts.set(s.id, 'none');
			return verdicts.set(s.id, s.cites.includes(match.source) ? 'drifted_quote' : 'wrong_source');
		}
		if (s.cites.length === 0) return verdicts.set(s.id, 'uncited');
		verdicts.set(s.id, s.cites.includes(match.source) ? 'none' : 'wrong_source');
	});
	return verdicts;
}

/* ------------------------------------------------------------ the classifier */

/** The harness's passages as the check returns them: the source is the work. */
export function asMatched(passages: Passage[]): MatchedPassage[] {
	return passages.map((p) => ({
		kind: p.kind,
		work: p.source,
		file: null,
		id: null,
		page: null,
		pageLabel: null,
		text: p.text
	}));
}

/**
 * The real check's verdicts: the matcher's spans (from `eval_attribution
 * match`, indexed by passage) classified with `thresholds`. Each labelled
 * sentence is checked with its own citations, outside any block quotation.
 */
export function classifierCheck(
	sentences: Pick<LabelledSentence, 'id' | 'text' | 'cites'>[],
	passages: MatchedPassage[],
	spans: Span[],
	thresholds?: Thresholds
): Map<string, Verdict> {
	const findings = classify(
		sentences.map((s) => ({ text: s.text, cites: s.cites, quoted: false })),
		{ spans, passages, read: passages.length },
		thresholds
	);
	return new Map(
		sentences.map((s, i) => [s.id, verdictOf(findings.filter((f) => f.sentence === i))])
	);
}

export interface SweepRow {
	thresholds: Thresholds;
	/** Sentences given the verdict they're labelled with. */
	right: number;
	precision: Record<Kind, number | null>;
	recall: Record<Kind, number | null>;
}

/** Every combination of the candidate thresholds, scored. */
export function sweep(
	sentences: LabelledSentence[],
	passages: MatchedPassage[],
	spans: Span[],
	candidates: { [K in keyof Thresholds]: readonly number[] }
): SweepRow[] {
	const rows: SweepRow[] = [];
	for (const minSharedWords of candidates.minSharedWords)
		for (const commonIn of candidates.commonIn)
			for (const commonShare of candidates.commonShare) {
				const thresholds = { minSharedWords, commonIn, commonShare };
				const report = score(
					'sweep',
					sentences,
					classifierCheck(sentences, passages, spans, thresholds)
				);
				const by = (pick: (k: KindScore) => number | null) =>
					Object.fromEntries(KINDS.map((k) => [k, pick(report.kinds[k])])) as Record<
						Kind,
						number | null
					>;
				rows.push({
					thresholds,
					right: report.sentences - report.wrong.length,
					precision: by((k) => k.precision),
					recall: by((k) => k.recall)
				});
			}
	return rows;
}
