/**
 * The attribution harness (M4-1): labelled sentences -> a confusion matrix per category.
 *
 * Reads the retrieval corpus's chunks, as the app's own extraction produced
 * them, and the labelled set in tests/fixtures/attribution. Refuses to score
 * when a label no longer matches the corpus, since a number measured against
 * the wrong text is worse than none. Records the result in last-run.json.
 *
 * Usage:
 *   ./scripts/fetch-retrieval-corpus.sh
 *   node scripts/eval/extract-chunks.mjs
 *   pnpm eval:attribution
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	baselineCheck,
	checkAgainstCorpus,
	checkLabels,
	formatReport,
	passagesFrom,
	score
} from '../../src/lib/attribution/evaluation.ts';

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

// The only check there is until M4-3 and M4-4; they add theirs beside it.
const checker = 'baseline';
const started = performance.now();
const verdicts = baselineCheck(fixture.sentences, passages);
const ms = performance.now() - started;

const report = score(checker, fixture.sentences, verdicts);
console.log(formatReport(report));
console.log(`\n${passages.length} passages read in ${ms.toFixed(0)} ms`);

writeFileSync(
	join(HERE, 'last-run.json'),
	`${JSON.stringify(
		{
			measured: new Date().toISOString().slice(0, 10),
			chunking: params,
			passages: passages.length,
			...report
		},
		null,
		'\t'
	)}\n`
);
