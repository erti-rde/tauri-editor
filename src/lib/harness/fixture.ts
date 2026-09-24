import type { Annotation, AnnotationLabel, Source } from '$lib/ipc';

// Two pages of our own text: the retrieval corpus is fetched on demand, so it
// can't be relied on here, and a paper of someone else's shouldn't be in the
// repository. Emitted as an asset only by builds that include the harness.
import paperUrl from '../../../tests/fixtures/harness/sample.pdf?url';

/**
 * What the fake backend starts from: one project a researcher might have open.
 *
 * Plain data, so a test can take the default and change the one thing it is
 * about (`{ ...defaultFixture(), styles: 'none' }`) rather than building a world
 * by hand. Every path is under `/fake`, which no real machine has, so nothing
 * here can be mistaken for a real file.
 */
export interface Fixture {
	/** The project folder. */
	root: string;
	/** Where the source library lives. */
	libraryPath: string;
	/** Sources in the library, all in the project. */
	sources: Source[];
	labels: AnnotationLabel[];
	marks: Annotation[];
	/**
	 * Files on the fake disk, by absolute path. A string is the file's text; a
	 * `{ pdf }` entry is a PDF served from a URL, so the reader can open it.
	 */
	files: Record<string, string | { pdf: string }>;
	/** Contents of each settings store, by file name. */
	stores: Record<string, Record<string, unknown>>;
	/** What the folder picker answers, in order. `null` is a cancelled dialog. */
	dialogAnswers: (string | null)[];
}

export const ROOT = '/fake/home/Documents/Thesis';
export const HOME = '/fake/home';

/** Hashes as the library stores them: 64 hex characters. */
export const SHA = {
	vaswani: 'a'.repeat(64),
	devlin: 'b'.repeat(64),
	scan: 'c'.repeat(64)
} as const;

const csl = (
	id: string,
	title: string,
	family: string,
	given: string,
	year: number,
	container: string
) =>
	JSON.stringify({
		id,
		type: 'paper-conference',
		title,
		author: [{ family, given }],
		issued: { 'date-parts': [[year]] },
		'container-title': container
	});

export const MANUSCRIPT = `${ROOT}/Chapter 1.erti.json`;

/**
 * A short chapter with a heading, prose and one citation: enough for the
 * outline, the word count, the citation renderer and the bibliography to each
 * have something to do.
 */
export const manuscript = {
	type: 'doc',
	content: [
		{
			type: 'heading',
			attrs: { level: 1 },
			content: [{ type: 'text', text: 'Attention in Low-Resource Translation' }]
		},
		{
			type: 'heading',
			attrs: { level: 2 },
			content: [{ type: 'text', text: 'Introduction' }]
		},
		{
			type: 'paragraph',
			content: [
				{
					type: 'text',
					text: 'Sequence models built on recurrence dominated machine translation until attention-only architectures showed that parallel training could reach better quality at lower cost '
				},
				{ type: 'citation', attrs: { id: SHA.vaswani } },
				{ type: 'text', text: '.' }
			]
		},
		{
			type: 'paragraph',
			content: [
				{
					type: 'text',
					text: 'Pre-trained bidirectional encoders later extended this to a wide range of tasks.'
				}
			]
		}
	]
};

function labels(): AnnotationLabel[] {
	return (
		[
			['claim', 'Claim', '45 95% 62%'],
			['evidence', 'Evidence', '145 50% 55%'],
			['method', 'Method', '210 80% 65%'],
			['limitation', 'Limitation', '5 80% 66%'],
			['definition', 'Definition', '185 55% 52%'],
			['counter-point', 'Counter-point', '280 50% 68%'],
			['interesting', 'Interesting', '325 70% 68%'],
			['my-opinion', 'My opinion', '220 12% 62%']
		] as const
	).map(([id, name, colour], position) => ({ id, name, colour, position, enabled: true }));
}

function mark(
	id: string,
	sha256: string,
	label_id: string,
	page: number,
	quote: string,
	note: string | null
): Annotation {
	return {
		id,
		sha256,
		kind: 'highlight',
		label_id,
		page,
		rects: '[]',
		quote,
		prefix: null,
		suffix: null,
		char_start: null,
		char_end: null,
		note,
		style: 'fill',
		page_label: null,
		origin: 'erti',
		// A minute apart, in the order they're listed, so "newest first" has an
		// answer.
		created_at: `2026-09-01T10:0${id.slice(-1)}:00Z`,
		updated_at: `2026-09-01T10:0${id.slice(-1)}:00Z`
	};
}

export function defaultFixture(): Fixture {
	const sources: Source[] = [
		{
			sha256: SHA.vaswani,
			file_name: 'vaswani-2017.pdf',
			path: `${ROOT}/papers/vaswani-2017.pdf`,
			csl_json: csl(
				SHA.vaswani,
				'Attention Is All You Need',
				'Vaswani',
				'Ashish',
				2017,
				'Advances in Neural Information Processing Systems'
			),
			zotero_type: 'conferencePaper',
			doi: '10.48550/arXiv.1706.03762',
			resolved_via: 'pdf-arxiv',
			state: 'ready',
			last_error: null
		},
		{
			sha256: SHA.devlin,
			file_name: 'devlin-2019.pdf',
			path: `${ROOT}/papers/devlin-2019.pdf`,
			csl_json: csl(
				SHA.devlin,
				'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
				'Devlin',
				'Jacob',
				2019,
				'Proceedings of NAACL-HLT'
			),
			zotero_type: 'conferencePaper',
			doi: '10.18653/v1/N19-1423',
			resolved_via: 'pdf-doi',
			state: 'ready',
			last_error: null
		},
		{
			// The case every library has: a scan with no identifier to look up.
			sha256: SHA.scan,
			file_name: 'scan-chapter.pdf',
			path: `${ROOT}/papers/scan-chapter.pdf`,
			csl_json: null,
			zotero_type: null,
			doi: null,
			resolved_via: null,
			state: 'failed',
			last_error: 'No DOI or arXiv identifier found in the first pages.'
		}
	];

	return {
		root: ROOT,
		libraryPath: `${HOME}/Erti/library.db`,
		sources,
		labels: labels(),
		// Quotes from the sample PDF every source opens as, so the reader can
		// find each mark on the page as well as list it.
		marks: [
			mark(
				'mark-1',
				SHA.vaswani,
				'claim',
				1,
				'Attention-only models replaced recurrence in machine translation',
				'Core claim; contrast with the RNN section'
			),
			mark(
				'mark-2',
				SHA.vaswani,
				'method',
				2,
				'We employ eight parallel attention layers, or heads.',
				null
			),
			mark(
				'mark-3',
				SHA.devlin,
				'evidence',
				2,
				'reporting strong results on eleven benchmarks',
				'Use in the literature review'
			)
		],
		files: {
			[MANUSCRIPT]: JSON.stringify(manuscript),
			[`${ROOT}/papers/vaswani-2017.pdf`]: { pdf: paperUrl },
			[`${ROOT}/papers/devlin-2019.pdf`]: { pdf: paperUrl },
			[`${ROOT}/papers/scan-chapter.pdf`]: { pdf: paperUrl }
		},
		stores: {
			'settings-store.json': {
				// Consent already given, so journeys start at the landing screen. The
				// consent journey clears it.
				allowNetworkLookups: false,
				recentProjects: [{ path: ROOT, name: 'Thesis', openedAt: '2026-09-24T09:00:00Z' }]
			}
		},
		dialogAnswers: []
	};
}
