/**
 * Shared helpers for the bundled CSL style index
 * (`src-tauri/resources/csl/cslStyles.json`).
 *
 * The index is a snapshot of the *independent* styles published in the
 * citation-style-language/styles repository. Styles under `dependent/` are
 * deliberately excluded: they carry no formatting rules of their own, only a
 * `rel="independent-parent"` pointer, so citeproc-js cannot render them without
 * first resolving that parent. Every dependent style is formatting-identical to
 * an independent style that *is* in the index.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const STYLES_REPO = 'citation-style-language/styles';
export const STYLES_REF = 'master';
export const RAW_BASE = `https://raw.githubusercontent.com/${STYLES_REPO}/${STYLES_REF}/`;
export const TREE_URL = `https://api.github.com/repos/${STYLES_REPO}/git/trees/${STYLES_REF}?recursive=1`;
export const RENAMED_URL = `${RAW_BASE}renamed-styles.json`;

export const INDEX_PATH = fileURLToPath(
	new URL('../src-tauri/resources/csl/cslStyles.json', import.meta.url)
);

/**
 * Display order of the style dropdown. `Intl.Collator` rather than a raw
 * code-unit sort so that accented and non-Latin titles land somewhere sensible.
 * Keep in sync with the ordering assertion in
 * `src/lib/side-panel/settings/cslStyles.test.ts`.
 */
export const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** @typedef {{ name: string; download_url: string }} CslStyle */

/**
 * @param {string} url
 * @param {{ headers?: Record<string, string>; attempts?: number }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, { headers = {}, attempts = 3 } = {}) {
	let lastError;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const response = await fetch(url, { headers });
			// 4xx answers are real answers - only retry server-side/transport hiccups.
			if (response.status < 500) return response;
			lastError = new Error(`${response.status} ${response.statusText}`);
		} catch (error) {
			lastError = error;
		}

		if (attempt < attempts) {
			await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
		}
	}

	throw new Error(`GET ${url} failed after ${attempts} attempts: ${lastError}`);
}

/** GitHub's API is rate limited to 60 requests/hour for anonymous callers. */
export function githubHeaders() {
	const token = process.env.GITHUB_TOKEN;
	return {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'citation-machine-csl-tooling',
		...(token ? { Authorization: `Bearer ${token}` } : {})
	};
}

/**
 * Every `.csl` blob in the upstream repository, split by kind.
 *
 * @returns {Promise<{ independent: string[]; dependent: string[] }>} file names
 *   (`apa.csl`) for root styles, paths (`dependent/blood.csl`) for the rest.
 */
export async function fetchUpstreamStyles() {
	const response = await fetchWithRetry(TREE_URL, { headers: githubHeaders() });

	if (!response.ok) {
		const hint = response.status === 403 ? ' (rate limited? set GITHUB_TOKEN)' : '';
		throw new Error(`Failed to list ${STYLES_REPO}: ${response.status}${hint}`);
	}

	const tree = await response.json();

	// A truncated tree would silently drop styles - exactly the failure mode that
	// left the index stuck at "h" when it was built from the paginated contents API.
	if (tree.truncated) {
		throw new Error(
			`GitHub returned a truncated tree for ${STYLES_REPO}; cannot trust the listing`
		);
	}

	const csl = tree.tree.filter((entry) => entry.type === 'blob' && entry.path.endsWith('.csl'));

	return {
		independent: csl.filter((entry) => !entry.path.includes('/')).map((entry) => entry.path),
		dependent: csl.filter((entry) => entry.path.startsWith('dependent/')).map((entry) => entry.path)
	};
}

/** Old style name -> current style name, for styles renamed upstream. */
export async function fetchRenamedStyles() {
	const response = await fetchWithRetry(RENAMED_URL);
	if (!response.ok) throw new Error(`Failed to fetch renamed-styles.json: ${response.status}`);
	return /** @type {Record<string, string>} */ (await response.json());
}

/** @param {CslStyle} style */
export function fileNameOf(style) {
	return style.download_url.slice(style.download_url.lastIndexOf('/') + 1);
}

/**
 * Why a style the index points at is no longer served from the repo root, so a
 * maintainer reading the failure knows what replaced it.
 *
 * @param {string} fileName
 * @param {{ dependent: Set<string>; renamed: Record<string, string>; independent: Set<string> }} upstream
 */
export function explainMissing(fileName, upstream) {
	const renamedTo = upstream.renamed[fileName.replace(/\.csl$/, '')];

	if (renamedTo) {
		const target = `${renamedTo}.csl`;
		if (upstream.independent.has(target)) return `renamed upstream to ${target}`;
		if (upstream.dependent.has(target)) return `renamed upstream to dependent/${target}`;
		return `renamed upstream to ${target}, which no longer exists either`;
	}

	if (upstream.dependent.has(fileName)) {
		return 'converted to a dependent style (now under dependent/)';
	}

	return 'removed upstream';
}

/**
 * Structural invariants the app relies on. Shared with
 * `src/lib/side-panel/settings/cslStyles.test.ts` so the script and the test
 * cannot drift apart.
 *
 * @param {unknown} styles
 * @returns {string[]} problems, empty when the index is well formed
 */
export function validateIndexShape(styles) {
	const problems = [];

	if (!Array.isArray(styles)) return ['index is not an array'];
	if (styles.length === 0) return ['index is empty'];

	const seenNames = new Map();
	const seenFiles = new Map();

	styles.forEach((style, i) => {
		if (typeof style?.name !== 'string' || style.name.trim() === '') {
			problems.push(`entry ${i}: missing name`);
		}
		if (typeof style?.download_url !== 'string' || !style.download_url.startsWith(RAW_BASE)) {
			problems.push(`entry ${i} (${style?.name}): download_url is not a ${RAW_BASE} URL`);
			return;
		}

		const fileName = fileNameOf(style);
		if (!fileName.endsWith('.csl')) {
			problems.push(`entry ${i} (${style.name}): ${fileName} is not a .csl file`);
		}
		// Dependent styles hold no formatting rules, so citeproc-js cannot use them.
		if (style.download_url.slice(RAW_BASE.length).includes('/')) {
			problems.push(`entry ${i} (${style.name}): ${fileName} is not a root-level style`);
		}

		if (seenNames.has(style.name)) {
			problems.push(`duplicate name "${style.name}" (entries ${seenNames.get(style.name)}, ${i})`);
		} else {
			seenNames.set(style.name, i);
		}

		if (seenFiles.has(fileName)) {
			problems.push(`duplicate style ${fileName} (entries ${seenFiles.get(fileName)}, ${i})`);
		} else {
			seenFiles.set(fileName, i);
		}
	});

	for (let i = 1; i < styles.length; i++) {
		if (collator.compare(styles[i - 1]?.name ?? '', styles[i]?.name ?? '') > 0) {
			problems.push(`out of order: "${styles[i].name}" sorts before "${styles[i - 1].name}"`);
			break;
		}
	}

	return problems;
}

/** @returns {Promise<CslStyle[]>} */
export async function readIndex() {
	return JSON.parse(await readFile(INDEX_PATH, 'utf8'));
}

/**
 * Runs `task` over `items` with a fixed number of workers.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} task
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<R[]>}
 */
export async function mapConcurrent(items, concurrency, task, onProgress) {
	const results = new Array(items.length);
	let next = 0;
	let done = 0;

	async function worker() {
		while (next < items.length) {
			const index = next++;
			results[index] = await task(items[index], index);
			done++;
			if (onProgress && (done % 50 === 0 || done === items.length)) onProgress(done, items.length);
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
	return results;
}
