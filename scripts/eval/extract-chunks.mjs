/**
 * Stage 1 of the retrieval benchmark: PDF -> chunks.json
 *
 * Deliberately mirrors the production ingest path in src/utils/pdf_handlers.ts
 * (pdf.js text extraction, then `llm-chunk` sentence splitting) so the benchmark
 * measures the pipeline the app actually ships. When Phase 2 rewrites extraction
 * and chunking, this file changes with it and the numbers stay comparable.
 *
 * Usage:
 *   node scripts/eval/extract-chunks.mjs [--min-length N] [--overlap N] [--out FILE]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chunk } from 'llm-chunk';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PAPERS = join(ROOT, 'tests/fixtures/retrieval/papers');

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : process.argv[i + 1];
}

const minLength = Number(arg('min-length', 100));
const overlap = Number(arg('overlap', 0));
const outFile = arg('out', join(ROOT, 'tests/fixtures/retrieval/chunks.json'));

if (!existsSync(PAPERS)) {
	console.error(`No corpus at ${PAPERS}\nRun: ./scripts/fetch-retrieval-corpus.sh`);
	process.exit(1);
}

// pdf.js ships a Node-compatible legacy build; the browser entry expects DOM globals.
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

/** A page's text content mixes positioned runs with marked-content markers. */
const isTextItem = (item) => 'str' in item;

async function extractText(bytes) {
	const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
	try {
		const pages = await Promise.all(
			Array.from({ length: doc.numPages }, async (_, i) => {
				const page = await doc.getPage(i + 1);
				const content = await page.getTextContent();
				page.cleanup();
				// NOTE: production joins with '' here, which glues words together.
				// Kept identical so the baseline reflects what the app really does —
				// Phase 2 fixes it, and the delta should show up in these numbers.
				return content.items
					.filter(isTextItem)
					.map((it) => it.str)
					.join('');
			})
		);
		return pages.join(' ');
	} finally {
		await doc.destroy();
	}
}

const files = readdirSync(PAPERS)
	.filter((f) => f.endsWith('.pdf'))
	.sort();
const out = [];
let totalChars = 0;

for (const file of files) {
	const id = file.replace(/\.pdf$/, '');
	const text = await extractText(new Uint8Array(readFileSync(join(PAPERS, file))));
	totalChars += text.length;

	const pieces = chunk(text, { minLength, overlap, splitter: 'sentence' });
	for (const [idx, t] of pieces.entries()) {
		out.push({ source: id, idx, text: t });
	}
	console.error(`  ${id.padEnd(16)} ${String(pieces.length).padStart(5)} chunks`);
}

writeFileSync(
	outFile,
	JSON.stringify({ params: { minLength, overlap, splitter: 'sentence' }, chunks: out }, null, '\t')
);

console.error('---');
console.error(
	`${files.length} papers, ${out.length} chunks, ${(totalChars / 1e6).toFixed(1)}M chars -> ${outFile}`
);
