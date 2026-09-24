/**
 * Fails when the bundled CSL style index has rotted against upstream.
 *
 *   pnpm csl:check           # one API call: diff the index against the repo listing
 *   pnpm csl:check --http    # additionally request every indexed URL (slow, exact)
 *   pnpm csl:check --strict  # also fail when upstream has styles we don't index
 *
 * The default mode is what CI runs on a schedule: it catches styles that were
 * renamed, removed, or converted to dependent styles upstream - every way an
 * indexed `download_url` can start returning 404 - without 2856 HTTP requests.
 * `--http` exists for the case where the tree listing and the raw CDN disagree.
 */

import {
	explainMissing,
	fetchUpstreamStyles,
	fetchRenamedStyles,
	fetchWithRetry,
	fileNameOf,
	INDEX_PATH,
	mapConcurrent,
	readIndex,
	validateIndexShape
} from './csl-styles.js';

const CONCURRENCY = 24;

/**
 * @param {import('./csl-styles.js').CslStyle[]} styles
 * @returns {Promise<import('./csl-styles.js').CslStyle[]>} entries that do not resolve
 */
async function httpCheck(styles) {
	let failed = 0;
	const results = await mapConcurrent(
		styles,
		CONCURRENCY,
		async (style) => {
			let response;
			try {
				response = await fetchWithRetry(style.download_url, { attempts: 2 });
			} catch (error) {
				// A connection that keeps failing is a finding about this one style,
				// not a reason to abandon the other 2,800 checks.
				failed++;
				return { style, status: error instanceof Error ? error.message : String(error) };
			}
			if (!response.ok) {
				failed++;
				return { style, status: response.status };
			}
			// Release the body so sockets are not held open.
			await response.arrayBuffer();
			return null;
		},
		(done, total) => process.stderr.write(`\r  ${done}/${total} checked, ${failed} failing`)
	);
	process.stderr.write('\n');

	return results.filter(Boolean);
}

async function main() {
	const args = process.argv.slice(2);
	const strict = args.includes('--strict');
	const http = args.includes('--http');

	const styles = await readIndex();
	console.log(`Checking ${styles.length} styles in ${INDEX_PATH}`);

	const shapeProblems = validateIndexShape(styles);
	if (shapeProblems.length) {
		console.error(`\n${shapeProblems.length} structural problem(s):`);
		for (const problem of shapeProblems.slice(0, 20)) console.error(`  - ${problem}`);
		if (shapeProblems.length > 20) console.error(`  ... and ${shapeProblems.length - 20} more`);
		process.exitCode = 1;
	}

	const [upstream, renamed] = await Promise.all([fetchUpstreamStyles(), fetchRenamedStyles()]);
	const independent = new Set(upstream.independent);
	const dependent = new Set(upstream.dependent.map((path) => path.replace(/^dependent\//, '')));
	const indexed = new Set(styles.map(fileNameOf));

	const broken = styles.filter((style) => !independent.has(fileNameOf(style)));
	const missing = upstream.independent.filter((file) => !indexed.has(file));

	if (broken.length) {
		console.error(`\n${broken.length} indexed style(s) no longer exist upstream:`);
		for (const style of broken) {
			const fileName = fileNameOf(style);
			console.error(
				`  - ${fileName} (${style.name}) - ${explainMissing(fileName, { dependent, renamed, independent })}`
			);
		}
		process.exitCode = 1;
	}

	if (missing.length) {
		const label = strict ? 'error' : 'warning';
		console.error(
			`\n${label}: upstream publishes ${missing.length} style(s) the index does not list` +
				`, e.g. ${missing.slice(0, 5).join(', ')}`
		);
		if (strict) process.exitCode = 1;
	}

	if (http) {
		console.log(`\nRequesting every indexed URL...`);
		const unreachable = await httpCheck(styles);
		if (unreachable.length) {
			console.error(`\n${unreachable.length} URL(s) did not resolve:`);
			for (const { style, status } of unreachable) {
				console.error(`  - ${status} ${style.download_url}`);
			}
			process.exitCode = 1;
		}
	}

	if (process.exitCode) {
		console.error('\nRun `pnpm csl:generate` to rebuild the index from upstream.');
		return;
	}

	console.log(
		`\nIndex is in sync with citation-style-language/styles` +
			`${missing.length ? ` (${missing.length} new upstream style(s) not yet indexed)` : ''}.`
	);
}

await main();
