/**
 * A home directory for one run of the real app (M1a-2).
 *
 * Erti keeps its library in `~/Erti` and its settings in the platform's app
 * data folder, both under `$HOME` on Linux, so pointing `HOME` somewhere fresh
 * gives every journey a first launch of its own without touching the runner.
 *
 * The project holds three small PDFs written here, two pages each of our own
 * text. Each prints the DOI of a real paper on the same subject, so that with
 * lookups allowed the app resolves real metadata for it, as it would for a
 * downloaded paper.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A minimal PDF: Helvetica, one text block per page, a correct xref. */
export function pdf(title, pages) {
	const escape = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
	const stream = (lines, first) =>
		[
			'BT',
			'/F1 11 Tf',
			'14 TL',
			'72 740 Td',
			...(first ? ['/F1 16 Tf', `(${escape(title)}) Tj`, '/F1 11 Tf', 'T*', 'T*'] : []),
			...lines.flatMap((l) => [`(${escape(l)}) Tj`, 'T*']),
			'ET'
		].join('\n');

	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	];
	pages.forEach((lines, i) => {
		const body = stream(lines, i === 0);
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
			`<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`
		);
	});

	let out = '%PDF-1.4\n';
	const offsets = objects.map((object, i) => {
		const at = Buffer.byteLength(out);
		out += `${i + 1} 0 obj\n${object}\nendobj\n`;
		return at;
	});
	const xref = Buffer.byteLength(out);
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (${escape(title)}) >> >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, 'latin1');
}

export const PAPERS = {
	'attention.pdf': pdf('Parallel Attention for Translation', [
		[
			'DOI: 10.48550/arXiv.1706.03762',
			'Abstract. Attention-only models replaced recurrence in machine',
			'translation because they train in parallel and reach better quality',
			'at lower cost. Self-attention relates every position of a sequence',
			'to every other position in a single step.'
		],
		['We employ eight parallel attention layers, or heads.']
	]),
	'encoders.pdf': pdf('Bidirectional Encoders in Practice', [
		[
			'DOI: 10.18653/v1/N19-1423',
			'Abstract. Pre-trained bidirectional encoders extended attention to a',
			'wide range of tasks, reporting strong results on eleven benchmarks.'
		],
		['Fine-tuning adds a single output layer for each downstream task.']
	]),
	'forests.pdf': pdf('Growing Forests for Classification', [
		[
			'DOI: 10.1023/A:1010933404324',
			'Abstract. Random forests average many decision trees grown on',
			'bootstrap samples, which lowers variance without raising bias much.'
		],
		['Each split considers a random subset of the features.']
	])
};

/**
 * Make a fresh home. Returns its paths; `settings` are written as the store
 * file the app reads on launch.
 */
export function makeHome({ settings = {} } = {}) {
	const home = mkdtempSync(join(tmpdir(), 'erti-e2e-'));
	const project = join(home, 'Documents', 'Thesis');
	mkdirSync(join(project, 'papers'), { recursive: true });
	// Opened before, as a project on the recent list has been: the folder
	// carries its `.erti` database, which is how Erti knows it may reopen it
	// without the folder picker (M1a-3). An empty file is a new database.
	mkdirSync(join(project, '.erti'));
	writeFileSync(join(project, '.erti', 'project.db'), '');
	for (const [name, bytes] of Object.entries(PAPERS)) {
		writeFileSync(join(project, 'papers', name), bytes);
	}

	writeFileSync(
		join(project, 'Chapter 1.erti.json'),
		JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })
	);

	// Where tauri-plugin-store keeps `settings-store.json` on Linux: the app
	// data folder, named for the bundle identifier.
	const appData = join(home, '.local', 'share', 'com.erti.app');
	mkdirSync(appData, { recursive: true });
	writeFileSync(
		join(appData, 'settings-store.json'),
		JSON.stringify({
			allowNetworkLookups: false,
			recentProjects: [{ path: project, name: 'Thesis', openedAt: new Date().toISOString() }],
			...settings
		})
	);

	return { home, project, appData };
}
