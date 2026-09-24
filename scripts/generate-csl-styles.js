/**
 * Regenerates `src-tauri/resources/csl/cslStyles.json` from the current contents
 * of the citation-style-language/styles repository.
 *
 *   pnpm csl:generate            # rewrite the index
 *   pnpm csl:generate --dry-run  # report what would change, write nothing
 *
 * Every indexed style is downloaded while generating, so a successful run is
 * also proof that none of the URLs it writes 404. `pnpm csl:check` re-verifies
 * that cheaply later on; see scripts/check-csl-styles.js.
 */

import { writeFile } from 'node:fs/promises';

import {
	RAW_BASE,
	collator,
	explainMissing,
	fetchRenamedStyles,
	fetchUpstreamStyles,
	fetchWithRetry,
	fileNameOf,
	INDEX_PATH,
	mapConcurrent,
	readIndex
} from './csl-styles.js';

const CONCURRENCY = 24;

const XML_ENTITIES = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&apos;': "'"
};

/** @param {string} value */
function decodeXml(value) {
	return value
		.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity])
		.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

/**
 * Pulls the human readable style name out of a CSL document. `<title-short>`
 * cannot match: the character after `title` is neither whitespace nor `>`.
 *
 * @param {string} xml
 */
function extractTitle(xml) {
	const match = xml.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/);
	if (!match) return null;
	return decodeXml(match[1]).replace(/\s+/g, ' ').trim();
}

/** @param {string} xml */
function isDependent(xml) {
	return /rel\s*=\s*(["'])independent-parent\1/.test(xml);
}

/**
 * @param {string} fileName
 * @returns {Promise<{ fileName: string; name: string }>}
 */
async function fetchStyle(fileName) {
	const url = RAW_BASE + fileName;
	const response = await fetchWithRetry(url);

	if (!response.ok) {
		throw new Error(`GET ${url} returned ${response.status}`);
	}

	const xml = await response.text();
	const name = extractTitle(xml);

	if (!name) throw new Error(`${fileName} has no <title>`);
	// Root-level styles are independent by repository convention. If that ever
	// stops holding, fail loudly rather than shipping a style citeproc can't run.
	if (isDependent(xml))
		throw new Error(`${fileName} is a dependent style but lives at the repo root`);

	return { fileName, name };
}

/**
 * Two styles may legitimately share a `<title>` (e.g. a journal that publishes
 * separate numeric and author-date variants). The dropdown keys on the name, so
 * disambiguate with the file name to keep every entry selectable.
 *
 * @param {{ fileName: string; name: string }[]} styles
 */
function dedupeNames(styles) {
	const counts = new Map();
	for (const { name } of styles) counts.set(name, (counts.get(name) ?? 0) + 1);

	return styles.map((style) =>
		counts.get(style.name) > 1
			? { ...style, name: `${style.name} (${style.fileName.replace(/\.csl$/, '')})` }
			: style
	);
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');

	process.stderr.write(`Listing styles in citation-style-language/styles...\n`);
	const [{ independent, dependent }, renamed] = await Promise.all([
		fetchUpstreamStyles(),
		fetchRenamedStyles()
	]);
	process.stderr.write(
		`  ${independent.length} independent styles, ${dependent.length} dependent (skipped)\n`
	);

	process.stderr.write(`Downloading ${independent.length} styles to read their titles...\n`);
	const fetched = await mapConcurrent(independent, CONCURRENCY, fetchStyle, (done, total) =>
		process.stderr.write(`\r  ${done}/${total}`)
	);
	process.stderr.write('\n');

	const styles = dedupeNames(fetched)
		.map(({ name, fileName }) => ({ name, download_url: RAW_BASE + fileName }))
		.sort(
			(a, b) => collator.compare(a.name, b.name) || a.download_url.localeCompare(b.download_url)
		);

	const previous = await readIndex().catch(() => []);
	const before = new Set(previous.map(fileNameOf));
	const after = new Set(styles.map(fileNameOf));
	const removed = [...before].filter((file) => !after.has(file));
	const added = [...after].filter((file) => !before.has(file));

	process.stderr.write(
		`\n${previous.length} -> ${styles.length} styles (+${added.length}, -${removed.length})\n`
	);
	if (removed.length) {
		const upstream = {
			independent: after,
			dependent: new Set(dependent.map((path) => path.replace(/^dependent\//, ''))),
			renamed
		};
		process.stderr.write(`Dropped:\n`);
		for (const file of removed.sort()) {
			process.stderr.write(`  - ${file} - ${explainMissing(file, upstream)}\n`);
		}
	}

	if (dryRun) {
		process.stderr.write('\n--dry-run: index not written\n');
		return;
	}

	await writeFile(INDEX_PATH, `${JSON.stringify(styles, null, '\t')}\n`);
	process.stderr.write(`\nWrote ${INDEX_PATH}\n`);
}

await main();
