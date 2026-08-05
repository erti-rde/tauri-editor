// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { extractPages, pagesToText } from './extract';
import { resolveMetadata, type ResolveResult } from './resolve';

/**
 * The measurement that started all of this, re-run against real papers.
 *
 * The dev database had usable citation metadata for 4 of 46 PDFs — 9% — with
 * half the rows stored as the literal string '{}' and 41% never processed at
 * all. Every citation feature consumes author, title and year, so that number
 * was the gate on the whole project.
 *
 * The unit tests elsewhere in this directory drive the resolver with crafted
 * text. This drives it with the actual output of the actual extractor over
 * twenty real journal-formatted PDFs, which is where the 9% came from and the
 * only place a claim about it can honestly be made.
 *
 * Offline by default: no request leaves the machine, matching a user who
 * declined the consent prompt. Set ERTI_EVAL_ONLINE=1 to also exercise the
 * doi.org path, which is a manual verification rather than a CI gate.
 */

const CORPUS = path.resolve('tests/fixtures/retrieval/papers');

interface Row {
	file: string;
	identifier: string | null;
	title: string | null;
	serialised: string | null;
}

let files: string[] = [];
const rows: Row[] = [];

async function corpusFiles(): Promise<string[]> {
	try {
		return (await readdir(CORPUS)).filter((f) => f.endsWith('.pdf')).sort();
	} catch {
		return [];
	}
}

files = await corpusFiles();

// The corpus is fetched by scripts/eval, not committed. Skip rather than fail
// so a fresh clone still runs green.
describe.skipIf(files.length === 0)('metadata health on the real corpus', () => {
	beforeAll(async () => {
		const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
		pdfjs.GlobalWorkerOptions.workerSrc = path.resolve(
			'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
		);

		for (const file of files) {
			const bytes = new Uint8Array(await readFile(path.join(CORPUS, file)));
			const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;

			const pages = await extractPages(doc);
			const info = (await doc.getMetadata()).info;

			// Identifiers are printed on the first page and sometimes repeated at
			// the end. This is what pdf_handlers passes in.
			const edges = [pages[0], pages[pages.length - 1]].filter(Boolean);

			const result: ResolveResult = await resolveMetadata({
				info,
				text: pagesToText(edges),
				allowNetwork: false
			});

			rows.push({
				file,
				identifier: result.identifier && `${result.identifier.kind}:${result.identifier.value}`,
				title: typeof result.resolved?.csl.title === 'string' ? result.resolved.csl.title : null,
				serialised: result.resolved ? JSON.stringify(result.resolved.csl) : null
			});

			await doc.destroy();
		}

		const found = rows.filter((r) => r.identifier).length;
		console.log(
			`\n  metadata health, offline: ${found}/${rows.length} papers carry a findable identifier` +
				`\n  (the dev corpus resolved 4 of 46 — 9% — with 23 rows stored as '{}')\n`
		);
		for (const r of rows.filter((r) => !r.identifier)) {
			console.log(`  no identifier: ${r.file}`);
		}
	}, 600_000);

	it('finds an identifier in every paper without touching the network', () => {
		// This is what makes declining the consent prompt a real option rather
		// than a dead end: the offline scan alone gives every paper something
		// precise to look up later, or to hand to the manual entry field.
		const missing = rows.filter((r) => !r.identifier).map((r) => r.file);

		expect(missing).toEqual([]);
	});

	it('never stores a placeholder', () => {
		// '{}' is metadata that looks resolved and is never retried. It was half
		// the dev corpus, and removing it is the point of the resolver chain.
		const placeholders = rows.filter((r) => r.serialised === '{}' || r.serialised === 'null');

		expect(placeholders).toEqual([]);
	});

	it('reports no title offline, because resolving one requires a lookup', () => {
		// Finding an identifier is not resolving metadata. Conflating the two is
		// how the offline path came to return `{ DOI: undefined }`.
		expect(rows.every((r) => r.title === null)).toBe(true);
	});
});

/**
 * The number the project is actually judged on: how many papers end up citable.
 *
 * Off by default — it makes real requests to doi.org, so it is a manual
 * verification rather than a CI gate. The requests carry only the identifier
 * printed in the paper, which is public.
 */
describe.skipIf(files.length === 0 || !process.env.ERTI_EVAL_ONLINE)(
	'metadata health with lookups allowed',
	() => {
		const online: Row[] = [];

		beforeAll(async () => {
			const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
			pdfjs.GlobalWorkerOptions.workerSrc = path.resolve(
				'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
			);

			for (const file of files) {
				const bytes = new Uint8Array(await readFile(path.join(CORPUS, file)));
				const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
				const pages = await extractPages(doc);
				const info = (await doc.getMetadata()).info;
				const edges = [pages[0], pages[pages.length - 1]].filter(Boolean);

				const result = await resolveMetadata({
					info,
					text: pagesToText(edges),
					allowNetwork: true,
					mailto: 'eval@erti.invalid'
				});

				online.push({
					file,
					identifier: result.identifier && `${result.identifier.kind}:${result.identifier.value}`,
					title: typeof result.resolved?.csl.title === 'string' ? result.resolved.csl.title : null,
					serialised: result.resolved ? JSON.stringify(result.resolved.csl) : null
				});

				await doc.destroy();
			}

			const resolved = online.filter((r) => r.title).length;
			const pct = Math.round((resolved / online.length) * 100);
			console.log(`\n  resolved to a citable title: ${resolved}/${online.length} (${pct}%)`);
			console.log(`  the dev corpus managed 4 of 46 (9%)\n`);
			for (const r of online) {
				console.log(`  ${r.title ? '✓' : '✗'} ${r.file.padEnd(18)} ${r.title?.slice(0, 52) ?? ''}`);
			}
		}, 900_000);

		it('resolves the large majority to a citable title', () => {
			const resolved = online.filter((r) => r.title).length;

			// The plan's target is "the large majority", against a 9% baseline.
			expect(resolved / online.length).toBeGreaterThan(0.8);
		});

		it('still never stores a placeholder', () => {
			expect(online.filter((r) => r.serialised === '{}' || r.serialised === 'null')).toEqual([]);
		});
	}
);
