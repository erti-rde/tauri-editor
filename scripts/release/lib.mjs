/**
 * The release pipeline's decisions, kept out of YAML so they can be tested
 * (M7a-1, docs/release.md). The workflow calls the CLIs beside this file.
 */
import { createHash } from 'node:crypto';

/* ----------------------------------------------------------------- 1. verify */

/**
 * Everything wrong with releasing `tag`, or nothing.
 *
 * The version lives in three files and all three reach the user: the About
 * box, the updater's comparison, and the installer's name. A tag that
 * disagrees with them ships a build that claims to be something else.
 */
export function releaseProblems({ packageJson, tauriConf, cargoToml, changelog, tag }) {
	const problems = [];
	const npm = JSON.parse(packageJson).version;
	const tauri = JSON.parse(tauriConf).version;
	const cargo = /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms.exec(cargoToml)?.[1];

	if (!(npm === tauri && tauri === cargo)) {
		problems.push(
			`The version differs between package.json (${npm}), tauri.conf.json (${tauri}) and Cargo.toml (${cargo}).`
		);
	}
	if (tag !== undefined) {
		if (tag !== `v${npm}`) problems.push(`The tag ${tag} doesn't match the version ${npm}.`);
		if (changelogSection(changelog ?? '', npm) === null) {
			problems.push(`CHANGELOG.md has no section for ${npm}.`);
		}
	}
	return problems;
}

/** The body of the CHANGELOG section for `version`, or null. Headings: `## 1.0.0` or `## [1.0.0] - date`. */
export function changelogSection(changelog, version) {
	const lines = changelog.split('\n');
	const heading = new RegExp(`^##\\s+\\[?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`);
	const start = lines.findIndex((l) => heading.test(l));
	if (start === -1) return null;
	const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
	return lines
		.slice(start + 1, end === -1 ? undefined : end)
		.join('\n')
		.trim();
}

/* ------------------------------------------------------------------ 4. smoke */

/**
 * What every bundle has to carry. The model is 23 MB of `resources/` that
 * nothing else checks ships; without it the app exits at start.
 */
export const REQUIRED_RESOURCES = [
	'resources/all-MiniLM-L6-v2/model.onnx',
	'resources/all-MiniLM-L6-v2/tokenizer.json',
	'resources/csl/bundled.json',
	'resources/csl/cslStyles.json',
	'resources/csl/schema.json'
];

/**
 * Which required resources a bundle's file listing lacks. Paths are compared
 * by their ending, with either slash, since each format nests them differently.
 */
export function missingResources(listing) {
	const normalised = listing.map((path) => path.replace(/\\/g, '/'));
	return REQUIRED_RESOURCES.filter(
		(required) => !normalised.some((path) => path.endsWith(required))
	);
}

/* ------------------------------------------------------------------ 5. draft */

export function sha256sums(files) {
	return (
		files
			.map(({ name, bytes }) => `${createHash('sha256').update(bytes).digest('hex')}  ${name}`)
			.sort((a, b) => a.slice(66).localeCompare(b.slice(66)))
			.join('\n') + '\n'
	);
}

/**
 * Which updater platform an artefact serves, from its name. Tauri 2's
 * updater artefacts: the macOS `.app.tar.gz`, the Windows NSIS installer and
 * the Linux AppImage, each with a `.sig` beside it.
 */
export function updaterPlatform(name) {
	if (/aarch64.*\.app\.tar\.gz$/.test(name)) return 'darwin-aarch64';
	if (/x64.*\.app\.tar\.gz$|x86_64.*\.app\.tar\.gz$/.test(name)) return 'darwin-x86_64';
	if (/-setup\.exe$/.test(name)) return 'windows-x86_64';
	if (/\.AppImage$/.test(name)) return 'linux-x86_64';
	return null;
}

/**
 * `latest.json` for the updater, or null when nothing is signed: without the
 * updater key (M7a-2) there are no signatures, and an updater manifest
 * without them would be refused by every installed copy anyway.
 */
export function latestJson({ version, notes, pubDate, baseUrl, artefacts }) {
	const platforms = {};
	for (const { name, signature } of artefacts) {
		const platform = updaterPlatform(name);
		if (!platform || !signature) continue;
		platforms[platform] = {
			signature: signature.trim(),
			url: `${baseUrl}/${encodeURIComponent(name)}`
		};
	}
	if (Object.keys(platforms).length === 0) return null;
	return { version, notes, pub_date: pubDate, platforms };
}

export const FIRST_OPEN_GUIDE =
	'https://github.com/erti-rde/tauri-editor/blob/main/docs/first-open.md';

export function releaseNotes(section) {
	return `${section}\n\n---\n\nThe downloads aren't signed by Apple or Microsoft, so your computer will warn you the first time you open Erti. [How to open it, and why it warns](${FIRST_OPEN_GUIDE}). Check a download against \`SHA256SUMS.txt\` if you want to be sure it's the file we built.\n`;
}
