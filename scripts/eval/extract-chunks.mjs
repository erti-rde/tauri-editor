/**
 * Stage 1 of the retrieval benchmark: PDF -> chunks.json
 *
 * Imports the very same extraction and chunking the app runs, so the benchmark
 * measures what ships. This previously reimplemented the pipeline — including
 * its word-gluing join — which meant the two could drift apart silently.
 *
 * Usage:
 *   node scripts/eval/extract-chunks.mjs [--target-chars N] [--overlap N] [--keep-references]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractPages } from '../../src/lib/ingest/extract.ts';
import { chunkPages } from '../../src/lib/ingest/chunk.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PAPERS = join(ROOT, 'tests/fixtures/retrieval/papers');

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : process.argv[i + 1];
}

const targetChars = Number(arg('target-chars', 380));
const overlap = Number(arg('overlap', 0.15));
const excludeReferences = !process.argv.includes('--keep-references');
const outFile = arg('out', join(ROOT, 'tests/fixtures/retrieval/chunks.json'));

if (!existsSync(PAPERS)) {
	console.error(`No corpus at ${PAPERS}\nRun: ./scripts/fetch-retrieval-corpus.sh`);
	process.exit(1);
}

// pdf.js ships a Node-compatible legacy build; the browser entry expects DOM globals.
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const files = readdirSync(PAPERS)
	.filter((f) => f.endsWith('.pdf'))
	.sort();

const out = [];
let twoColumnPages = 0;
let totalPages = 0;

for (const file of files) {
	const id = file.replace(/\.pdf$/, '');
	const doc = await pdfjs.getDocument({
		data: new Uint8Array(readFileSync(join(PAPERS, file))),
		useSystemFonts: true
	}).promise;

	try {
		const pages = await extractPages(doc);
		const chunks = chunkPages(pages, { targetChars, overlap, excludeReferences });

		totalPages += pages.length;
		twoColumnPages += pages.filter((p) => p.columns === 2).length;

		for (const [idx, chunk] of chunks.entries()) {
			out.push({
				source: id,
				idx,
				text: chunk.text,
				page_start: chunk.pageStart,
				section: chunk.section
			});
		}
		console.error(`  ${id.padEnd(16)} ${String(chunks.length).padStart(5)} chunks`);
	} finally {
		await doc.destroy();
	}
}

writeFileSync(
	outFile,
	JSON.stringify(
		{
			params: { targetChars, overlap, excludeReferences, splitter: 'structure-aware' },
			chunks: out
		},
		null,
		'\t'
	)
);

console.error('---');
console.error(
	`${files.length} papers, ${out.length} chunks, ${twoColumnPages}/${totalPages} pages two-column -> ${outFile}`
);
