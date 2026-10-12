/**
 * The attribution harness (M4-1, M4-3, M4-4): labelled sentences -> a confusion
 * matrix per category.
 *
 * Reads the retrieval corpus's chunks, as the app's own extraction produced
 * them, and the labelled set in tests/fixtures/attribution. Refuses to score
 * when a label no longer matches the corpus, since a number measured against
 * the wrong text is worse than none.
 *
 * Then runs the app's own matcher (Rust, `eval_attribution match`) over them,
 * and refuses again if the TypeScript normaliser disagrees with Rust's about
 * any word, or the fake backend's matcher about any span. It sweeps the
 * classifier's thresholds, scores the chosen ones and the baseline, and
 * records the lot in last-run.json.
 *
 * Usage:
 *   ./scripts/fetch-retrieval-corpus.sh
 *   node scripts/eval/extract-chunks.mjs
 *   pnpm eval:attribution
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { THRESHOLDS } from '../../src/lib/attribution/classify.ts';
import {
	asMatched,
	baselineCheck,
	checkAgainstCorpus,
	checkLabels,
	classifierCheck,
	fixtureFingerprint,
	formatReport,
	KINDS,
	passagesFrom,
	score,
	sweep
} from '../../src/lib/attribution/evaluation.ts';
import { words } from '../../src/lib/attribution/normalise.ts';
import { matchSpans } from '../../src/lib/harness/fakeMatcher.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RETRIEVAL = join(ROOT, 'tests/fixtures/retrieval');
const HERE = join(ROOT, 'tests/fixtures/attribution');
const CHUNKS = join(RETRIEVAL, 'chunks.json');

if (!existsSync(CHUNKS)) {
	console.error(
		`No chunks at ${CHUNKS}\nRun: ./scripts/fetch-retrieval-corpus.sh && node scripts/eval/extract-chunks.mjs`
	);
	process.exit(1);
}

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const { params, chunks } = read(CHUNKS);
const corpus = read(join(RETRIEVAL, 'corpus.json'));
const fixture = read(join(HERE, 'sentences.json'));

const passages = passagesFrom(chunks, fixture);
const problems = [
	...checkLabels(
		fixture,
		corpus.map((paper) => paper.id)
	),
	...checkAgainstCorpus(fixture, passages)
];
if (problems.length > 0) {
	console.error(`The labels don't match the corpus (${problems.length}):`);
	for (const problem of problems) console.error(`  ${problem}`);
	process.exit(1);
}

/* -------------------------------------------------------------- the matcher */

const scratch = mkdtempSync(join(tmpdir(), 'erti-attribution-'));
const input = join(scratch, 'input.json');
const output = join(scratch, 'output.json');
const sentenceTexts = fixture.sentences.map((s) => s.text);
writeFileSync(
	input,
	JSON.stringify({
		sentences: sentenceTexts,
		passages: passages.map(({ source, text }) => ({ source, text }))
	})
);
const cargo = spawnSync(
	'cargo',
	['run', '--release', '--quiet', '--bin', 'eval_attribution', '--', 'match', input, output],
	{ cwd: join(ROOT, 'src-tauri'), stdio: ['ignore', 'inherit', 'inherit'] }
);
if (cargo.status !== 0) {
	console.error('eval_attribution match failed');
	process.exit(1);
}
const matched = read(output);
rmSync(scratch, { recursive: true, force: true });

// The classifier reads the matcher's word indices against its own words, so
// the two normalisers must agree on every word of the real corpus.
const disagreements = [];
const compare = (label, text, rust) => {
	const ts = words(text);
	if (JSON.stringify(ts) !== JSON.stringify(rust)) disagreements.push({ label, ts, rust });
};
sentenceTexts.forEach((text, i) =>
	compare(fixture.sentences[i].id, text, matched.words.sentences[i])
);
passages.forEach((p, i) =>
	compare(`passage ${i} (${p.source})`, p.text, matched.words.passages[i])
);
if (disagreements.length > 0) {
	console.error(`The normalisers disagree on ${disagreements.length} texts:`);
	for (const { label, ts, rust } of disagreements.slice(0, 10)) {
		// Up to the longer of the two, so a word only one of them has is named.
		const at = Array.from({ length: Math.max(ts.length, rust.length) }, (_, i) => i).find(
			(i) => ts[i] !== rust[i]
		);
		console.error(
			`  ${label}: word ${at}: ts ${JSON.stringify(ts[at])}, rust ${JSON.stringify(rust[at])}`
		);
	}
	process.exit(1);
}

// And the fake backend's matcher must find what Rust finds.
// Rust's score is an f32, so the two agree to its precision, not to a double's.
const key = (span) =>
	JSON.stringify({
		...span,
		verbatimScore: span.verbatimScore.toFixed(5),
		sources: [...span.sources].sort((a, b) => a - b)
	});
const fake = matchSpans(sentenceTexts, passages).map(key);
const real = matched.spans.map(key);
if (JSON.stringify(fake) !== JSON.stringify(real)) {
	const missing = real.filter((k) => !fake.includes(k));
	const extra = fake.filter((k) => !real.includes(k));
	console.error(
		`The fake matcher disagrees with Rust: ${missing.length} missing, ${extra.length} extra`
	);
	for (const k of [...missing.slice(0, 3), ...extra.slice(0, 3)]) console.error(`  ${k}`);
	process.exit(1);
}

/* ------------------------------------------------------------------- scoring */

const asPassages = asMatched(passages);

// Every combination, so the chosen thresholds are seen against the others.
const rows = sweep(fixture.sentences, asPassages, matched.spans, {
	minSharedWords: [6, 7, 8, 10, 12],
	commonIn: [3, 5, 8, 10],
	commonShare: [0.25, 0.5, 0.75, 1]
});
const best = Math.max(...rows.map((r) => r.right));
const pct = (v) => (v === null ? '   —' : `${(v * 100).toFixed(0).padStart(3)}%`);
console.log(`Threshold sweep (${rows.length} combinations), the best by sentences right:`);
console.log(
	`  words  common-in  share  right   ${KINDS.map((k) => k.slice(0, 9).padStart(9)).join(' ')}  (precision)`
);
for (const row of rows.filter((r) => r.right >= best - 2).sort((a, b) => b.right - a.right)) {
	const t = row.thresholds;
	const chosen =
		t.minSharedWords === THRESHOLDS.minSharedWords &&
		t.commonIn === THRESHOLDS.commonIn &&
		t.commonShare === THRESHOLDS.commonShare;
	console.log(
		`  ${String(t.minSharedWords).padStart(5)}  ${String(t.commonIn).padStart(9)}  ${t.commonShare.toFixed(2).padStart(5)}  ${String(row.right).padStart(5)}   ${KINDS.map((k) => pct(row.precision[k]).padStart(9)).join(' ')}${chosen ? '  ← chosen' : ''}`
	);
}

const baseline = score('baseline', fixture.sentences, baselineCheck(fixture.sentences, passages));
const report = score(
	'classifier',
	fixture.sentences,
	classifierCheck(fixture.sentences, asPassages, matched.spans, THRESHOLDS)
);
console.log(`\n${formatReport(report)}`);
console.log(
	`\n${passages.length} passages matched in ${matched.ms.toFixed(0)} ms; the baseline got ${baseline.sentences - baseline.wrong.length}/${baseline.sentences} right`
);

writeFileSync(
	join(HERE, 'last-run.json'),
	`${JSON.stringify(
		{
			measured: new Date().toISOString().slice(0, 10),
			fixture: fixtureFingerprint(fixture),
			chunking: params,
			passages: passages.length,
			thresholds: THRESHOLDS,
			...report,
			baseline: { right: baseline.sentences - baseline.wrong.length, kinds: baseline.kinds },
			sweep: rows
		},
		null,
		'\t'
	)}\n`
);
