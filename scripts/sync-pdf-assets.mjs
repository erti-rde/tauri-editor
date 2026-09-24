/**
 * Copy pdf.js's character maps and standard fonts into `static/`.
 *
 * pdf.js does not bundle either: it fetches them at run time from wherever
 * `cMapUrl` and `standardFontDataUrl` point. Without the standard fonts, a PDF
 * that names Helvetica or Times without embedding it renders in a substitute
 * with the wrong metrics, and without the character maps a CJK paper renders as
 * nothing at all. Neither failure is loud — pdf.js warns to the console and
 * carries on drawing something wrong.
 *
 * They are copied rather than committed because they are 12 MB of generated
 * files belonging to a pinned dependency: committing them is how the previous
 * vendored viewer came to be a minor version ahead of the library it ran
 * beside. Copying keeps one version, the one in package.json.
 *
 * `static/pdf-assets/` is gitignored, and this runs before dev and before build.
 */

import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'pdfjs-dist');
const to = join(root, 'static', 'pdf-assets');

const DIRECTORIES = ['cmaps', 'standard_fonts'];

if (!existsSync(from)) {
	console.error('pdfjs-dist is not installed — run `pnpm install` first.');
	process.exit(1);
}

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });

for (const directory of DIRECTORIES) {
	const source = join(from, directory);

	if (!existsSync(source)) {
		console.error(`pdfjs-dist has no ${directory}/ — the package layout has changed.`);
		process.exit(1);
	}

	await cp(source, join(to, directory), { recursive: true });
}

console.log(`pdf.js assets synced to static/pdf-assets/ (${DIRECTORIES.join(', ')})`);
