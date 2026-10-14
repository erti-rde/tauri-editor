import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core';

import { Editor } from '$lib/editor/core/Editor';
import { editorExtensions } from '$lib/editor/core/extensions';
import { checkEditor } from '$lib/editor/checkEditor';
import { matchSpans } from '$lib/harness/fakeMatcher';
import type { AttributionMatches, DismissedFinding, MatchedPassage } from '$lib/ipc';
import { showInPdf } from '$lib/pdfreader/showInPdf';
import { checkAttribution } from '$lib/stores/db';
import { errorToast } from '$lib/ui/Toast.svelte';

import CheckPanel from './CheckPanel.svelte';
import { attributionCheck } from './check.svelte';
import * as copy from './copy';

/**
 * The Check panel over a real manuscript (M4-5 to M4-7).
 *
 * The editor, the sentence walk, the classifier and the bridge are the real
 * ones. Only the backend is stood in for: the check is answered by the
 * TypeScript twin of the Rust matcher, over the passages below, so the spans
 * are the ones the app would get.
 */

const VASWANI =
	'Recurrent models have dominated sequence transduction for many years in nearly every lab, until attention arrived.';
const DEVLIN =
	'We obtain new state of the art results on eleven natural language processing tasks including question answering.';
const OTHER_CHAPTER =
	'Low resource settings magnify every design choice that a larger corpus would quietly absorb.';

const PASSAGES: MatchedPassage[] = [
	{
		kind: 'chunk',
		work: 'vaswani',
		file: 'vaswani',
		id: null,
		page: 2,
		pageLabel: null,
		text: VASWANI
	},
	{
		kind: 'chunk',
		work: 'devlin',
		file: 'devlin',
		id: null,
		page: 1,
		pageLabel: null,
		text: DEVLIN
	},
	{
		kind: 'document',
		work: 'chapter-3.erti.json',
		file: null,
		id: null,
		page: null,
		pageLabel: null,
		text: OTHER_CHAPTER
	}
];

let dismissed: DismissedFinding[] = [];

vi.mock('$lib/stores/db', async (original) => ({
	...(await original<typeof import('$lib/stores/db')>()),
	checkAttribution: vi.fn(async (_document: string | null, sentences: string[]) => {
		const spans = matchSpans(
			sentences,
			PASSAGES.map((p) => ({
				source: p.kind === 'document' ? `document:${p.work}` : p.work,
				text: p.text
			}))
		);
		const used = [...new Set(spans.map((s) => s.passage))].sort((a, b) => a - b);
		const index = new Map(used.map((fed, i) => [fed, i]));
		const result: AttributionMatches = {
			spans: spans.map((s) => ({ ...s, passage: index.get(s.passage)! })),
			passages: used.map((i) => PASSAGES[i]),
			read: PASSAGES.length,
			sources: 2,
			documents: 1
		};
		return result;
	}),
	libraryWorks: vi.fn(async () => [
		{
			id: 'vaswani',
			doi: null,
			csl_json: JSON.stringify({
				author: [{ family: 'Vaswani' }, { family: 'Shazeer' }, { family: 'Parmar' }],
				issued: { 'date-parts': [[2017]] }
			})
		},
		{
			id: 'devlin',
			doi: null,
			csl_json: JSON.stringify({
				author: [{ family: 'Devlin' }],
				issued: { 'date-parts': [[2019]] }
			})
		},
		{
			id: 'ong',
			doi: null,
			csl_json: JSON.stringify({ author: [{ family: 'Ong' }], issued: { 'date-parts': [[1982]] } })
		}
	]),
	dismissedFindings: vi.fn(async () => structuredClone(dismissed)),
	dismissFinding: vi.fn(async (f: DismissedFinding) => {
		dismissed.push(f);
	}),
	restoreFinding: vi.fn(async (f: DismissedFinding) => {
		dismissed = dismissed.filter(
			(d) =>
				!(d.sentenceHash === f.sentenceHash && d.canonicalId === f.canonicalId && d.kind === f.kind)
		);
	})
}));
vi.mock('$lib/pdfreader/showInPdf', () => ({ showInPdf: vi.fn(async () => true) }));
vi.mock('$lib/ui/Toast.svelte', () => ({ errorToast: vi.fn(), successToast: vi.fn() }));

const text = (value: string): JSONContent => ({ type: 'text', text: value });
const cite = (id: string): JSONContent => ({
	type: 'citation',
	attrs: { id: JSON.stringify([id]) }
});
const para = (...content: Array<string | JSONContent>): JSONContent => ({
	type: 'paragraph',
	content: content.map((part) => (typeof part === 'string' ? text(part) : part))
});

/** Borrowed from Vaswani, with no citation. */
const UNCITED =
	'Recurrent models have dominated sequence transduction for many years in nearly every lab.';
/** Quoted from Devlin, cited to Devlin, with a word dropped. */
const DRIFTED = 'BERT “obtains new state of the art results on eleven natural language tasks” ';
/** Vaswani's words, cited to Ong. */
const WRONG =
	'As Ong put it, sequence transduction for many years in nearly every lab, until attention arrived ';
/** From the project's chapter 3. */
const REUSED =
	'Low resource settings magnify every design choice that a larger corpus would quietly absorb.';
const UNTOUCHED = 'Nothing here is borrowed from anywhere at all.';

const MANUSCRIPT = [
	para(UNCITED, ' ', UNTOUCHED),
	para(DRIFTED, cite('devlin'), '.'),
	para(WRONG, cite('ong'), '.'),
	para(REUSED)
];

let editor: Editor | undefined;
let host: HTMLElement | undefined;

/** Cites as `citeWork` would, without the project's citation store. */
async function citeNow(instance: TiptapEditor, work: string) {
	instance.commands.insertCitation({
		id: JSON.stringify([work]),
		label: `(${work})`,
		locators: null
	});
}

function openManuscript(content: JSONContent[] = MANUSCRIPT, cite = citeNow) {
	host = document.createElement('div');
	document.body.append(host);
	editor = new Editor({
		element: host,
		extensions: editorExtensions,
		content: { type: 'doc', content }
	});
	const bridge = checkEditor(editor, () => 'chapter-1.erti.json', cite);
	// As Editor.svelte reports them: the writer's edits, not relabels or fixes.
	editor.on('update', ({ transaction }) => {
		if (transaction.getMeta('addToHistory') !== false) attributionCheck.edited();
	});
	attributionCheck.attach(bridge);
	return bridge;
}

beforeEach(() => {
	dismissed = [];
	attributionCheck.reset();
	vi.clearAllMocks();
});

afterEach(() => {
	editor?.destroy();
	host?.remove();
	editor = undefined;
	host = undefined;
	attributionCheck.reset();
});

const runCheck = async (user: ReturnType<typeof userEvent.setup>) => {
	await user.click(screen.getByRole('button', { name: copy.RUN }));
	await screen.findByText(/sentences checked against/);
};

const group = (kind: keyof typeof copy.GROUP_TITLES) =>
	screen.getByRole('region', { name: new RegExp(copy.GROUP_TITLES[kind]) });

describe('before a check', () => {
	// M4-5 AC-6
	it('never runs on its own, opening the panel or a document', async () => {
		openManuscript();
		render(CheckPanel);

		expect(screen.getByText(copy.NOT_RUN)).toBeInTheDocument();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(checkAttribution).not.toHaveBeenCalled();
	});

	// M4-5 AC-1
	it('asks for a document when none is open', () => {
		render(CheckPanel);
		expect(screen.getByText(copy.NO_DOCUMENT)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: copy.RUN })).toBeDisabled();
	});
});

describe('after a check', () => {
	// M4-5 AC-2, AC-3
	it('says what it covered in counts, and groups the findings by kind in words', async () => {
		const user = userEvent.setup();
		openManuscript();
		render(CheckPanel);
		await runCheck(user);

		expect(
			screen.getByText(
				'5 sentences checked against 2 sources in your library and 1 other document in this project.'
			)
		).toBeInTheDocument();
		expect(document.body.textContent).not.toMatch(/%|score/i);

		expect(
			within(group('uncited')).getByText(/Vaswani et al\. 2017 · p\. 2 · same words/)
		).toBeInTheDocument();
		expect(
			within(group('drifted_quote')).getByText(
				/Devlin 2019 · p\. 1 · source says “obtain … processing”/
			)
		).toBeInTheDocument();
		expect(
			within(group('wrong_source')).getByText(/Vaswani et al\. 2017 · p\. 2 · cited to Ong 1982/)
		).toBeInTheDocument();
		expect(within(group('self_reuse')).getByText('chapter-3')).toBeInTheDocument();
		// In UX-7's order, the order the writer meets them in the spec and mockup.
		const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
		expect(titles.map((t) => t?.replace(/\d+\s*$/, '').trim())).toEqual([
			copy.GROUP_TITLES.uncited,
			copy.GROUP_TITLES.drifted_quote,
			copy.GROUP_TITLES.wrong_source,
			copy.GROUP_TITLES.self_reuse
		]);
	});

	// M4-5 AC-2
	it('says there is nothing to review in the fixed words', async () => {
		const user = userEvent.setup();
		openManuscript([para(UNTOUCHED, ' And another plain sentence of our own making here.')]);
		render(CheckPanel);
		await runCheck(user);

		expect(screen.getByText(copy.NOTHING_TO_REVIEW)).toBeInTheDocument();
		expect(screen.getByText(copy.NOTHING_TO_REVIEW_DETAIL)).toBeInTheDocument();
	});

	// M4-5 AC-2
	it('says when nothing is long enough to compare, without asking the library', async () => {
		const user = userEvent.setup();
		openManuscript([para('Too short. Also short.')]);
		render(CheckPanel);
		await user.click(screen.getByRole('button', { name: copy.RUN }));

		expect(await screen.findByText(copy.TOO_SHORT)).toBeInTheDocument();
		expect(checkAttribution).not.toHaveBeenCalled();
	});

	// M4-5 AC-2
	it('says when the check failed, and offers to run it again', async () => {
		const user = userEvent.setup();
		vi.mocked(checkAttribution).mockRejectedValueOnce(new Error('The library isn’t open yet.'));
		openManuscript();
		render(CheckPanel);
		await user.click(screen.getByRole('button', { name: copy.RUN }));

		expect(await screen.findByText(copy.FAILED)).toBeInTheDocument();
		expect(screen.getByText(/library isn’t open/)).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: copy.RUN_AGAIN }));
		await screen.findByText(/sentences checked against/);
	});
});

describe('looking at a finding', () => {
	// M4-5 AC-4
	it('underlines only that sentence and opens the source beside it at the passage', async () => {
		const user = userEvent.setup();
		openManuscript();
		render(CheckPanel);
		await runCheck(user);

		const row = within(group('uncited')).getByRole('button', { name: /Recurrent models/ });
		await user.click(row);

		expect(row).toHaveAttribute('aria-pressed', 'true');
		const underlined = [...host!.querySelectorAll('.erti-check-sentence')].map(
			(e) => e.textContent
		);
		expect(underlined).toEqual([UNCITED]);
		expect(showInPdf).toHaveBeenCalledWith(
			{
				sha256: 'vaswani',
				page: 2,
				selector: { quote: expect.stringContaining('dominated sequence transduction') }
			},
			{ beside: true }
		);

		// Chosen again, it lets go.
		await user.click(row);
		expect(host!.querySelectorAll('.erti-check-sentence')).toHaveLength(0);
	});

	// M4-5 AC-5
	it('dims the findings and says so once the document changes', async () => {
		const user = userEvent.setup();
		openManuscript();
		render(CheckPanel);
		await runCheck(user);

		editor!.commands.insertContentAt(1, 'Indeed, ');
		expect(await screen.findByText(copy.STALE)).toBeInTheDocument();
		expect(document.querySelector('[data-stale]')).toBeInTheDocument();
		// The old findings are still there to read.
		expect(group('uncited')).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: copy.RUN_AGAIN }));
		await waitFor(() => expect(screen.queryByText(copy.STALE)).not.toBeInTheDocument());
	});

	// M4-5 AC-5
	it('says so when the document changed while the check was running', async () => {
		const user = userEvent.setup();
		openManuscript();
		render(CheckPanel);

		// The answer held back until the writer has typed.
		const answer = vi.mocked(checkAttribution).getMockImplementation()!;
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		vi.mocked(checkAttribution).mockImplementationOnce(async (...args) => {
			await held;
			return answer(...args);
		});

		await user.click(screen.getByRole('button', { name: copy.RUN }));
		editor!.commands.insertContentAt(1, 'Indeed, ');
		release();

		await screen.findByText(/sentences checked against/);
		expect(screen.getByText(copy.STALE)).toBeInTheDocument();
	});
});

describe('fixing a finding', () => {
	// M4-6 AC-1
	it('offers each fix only where it fits', async () => {
		const user = userEvent.setup();
		openManuscript();
		render(CheckPanel);
		await runCheck(user);

		const actions = (kind: keyof typeof copy.GROUP_TITLES) =>
			within(group(kind))
				.getAllByRole('button')
				.filter((b) => !b.hasAttribute('aria-pressed'))
				.map((b) => b.textContent?.trim());

		expect(actions('uncited')).toEqual([
			copy.ACTIONS.quoteAndCite,
			copy.ACTIONS.cite,
			copy.ACTIONS.showSource,
			copy.ACTIONS.dismiss
		]);
		expect(actions('drifted_quote')).toEqual([
			copy.ACTIONS.useSourceWords,
			copy.ACTIONS.showSource,
			copy.ACTIONS.dismiss
		]);
		expect(actions('wrong_source')).toEqual([
			copy.ACTIONS.cite,
			copy.ACTIONS.showSource,
			copy.ACTIONS.dismiss
		]);
		// Another document has no file to open beside this one.
		expect(actions('self_reuse')).toEqual([copy.ACTIONS.dismiss]);
	});

	// M4-6 AC-2
	it('checks the sentence again after a fix, and the finding clears', async () => {
		const user = userEvent.setup();
		openManuscript();
		render(CheckPanel);
		await runCheck(user);

		await user.click(within(group('uncited')).getByRole('button', { name: copy.ACTIONS.cite }));

		await waitFor(() =>
			expect(
				screen.queryByRole('region', { name: new RegExp(copy.GROUP_TITLES.uncited) })
			).not.toBeInTheDocument()
		);
		// Asked about that one sentence, now cited.
		// The sentence's text leaves the citation out, as the walk reads it.
		expect(vi.mocked(checkAttribution).mock.lastCall).toEqual([
			'chapter-1.erti.json',
			[UNCITED.replace(/\.$/, ' .')]
		]);
		// The fix's own edit isn't a change that makes the check stale.
		expect(screen.queryByText(copy.STALE)).not.toBeInTheDocument();
		expect(group('drifted_quote')).toBeInTheDocument();
	});

	// M4-8 AC-1: a fix that isn't made says why, and only what's so.
	it('says the sentence changed only when it did', async () => {
		const user = userEvent.setup();
		openManuscript();
		render(CheckPanel);
		await runCheck(user);

		// Typed into the sentence after the check: its words aren't where they were.
		const at = editor!.state.doc.textContent.indexOf('dominated') + 1;
		editor!.commands.insertContentAt(at, 'long ');
		await user.click(within(group('uncited')).getByRole('button', { name: copy.ACTIONS.cite }));

		expect(errorToast).toHaveBeenCalledWith(copy.FIX_FAILED);
		expect(vi.mocked(checkAttribution)).toHaveBeenCalledTimes(1);
	});

	// M4-8 AC-1
	it('says a fix was not made, not that the sentence changed, when citing is refused', async () => {
		const user = userEvent.setup();
		// As `citeWork` does for a work with no citation details: it says why
		// itself, and inserts nothing.
		openManuscript(MANUSCRIPT, async () => {});
		render(CheckPanel);
		await runCheck(user);

		await user.click(within(group('uncited')).getByRole('button', { name: copy.ACTIONS.cite }));

		expect(errorToast).toHaveBeenCalledWith(copy.FIX_NOT_MADE);
		expect(errorToast).not.toHaveBeenCalledWith(copy.FIX_FAILED);
		expect(group('uncited')).toBeInTheDocument();
	});

	// M4-6 AC-2
	it('puts the source’s words into a drifted quotation, and the finding clears', async () => {
		const user = userEvent.setup();
		openManuscript();
		render(CheckPanel);
		await runCheck(user);

		await user.click(
			within(group('drifted_quote')).getByRole('button', { name: copy.ACTIONS.useSourceWords })
		);

		await waitFor(() =>
			expect(
				screen.queryByRole('region', { name: new RegExp(copy.GROUP_TITLES.drifted_quote) })
			).not.toBeInTheDocument()
		);
		expect(editor!.state.doc.textContent).toContain(
			'“obtain new state of the art results on eleven natural language processing tasks”'
		);
	});
});

describe('dismissing a finding', () => {
	// M4-7 AC-2, AC-3
	it('sets it aside for this project, keeps it through another check, and can restore it', async () => {
		const user = userEvent.setup();
		openManuscript();
		render(CheckPanel);
		await runCheck(user);

		await user.click(
			within(group('self_reuse')).getByRole('button', { name: copy.ACTIONS.dismiss })
		);
		expect(
			screen.queryByRole('region', { name: new RegExp(copy.GROUP_TITLES.self_reuse) })
		).not.toBeInTheDocument();
		const toggle = screen.getByRole('button', { name: copy.DISMISSED(1) });
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		expect(dismissed).toEqual([
			{
				sentenceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
				canonicalId: 'chapter-3.erti.json',
				kind: 'self_reuse'
			}
		]);

		// Still set aside after checking again: it's read back from the project.
		await user.click(screen.getByRole('button', { name: copy.RUN }));
		await waitFor(() => expect(checkAttribution).toHaveBeenCalledTimes(2));
		expect(await screen.findByRole('button', { name: copy.DISMISSED(1) })).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: copy.DISMISSED(1) }));
		await user.click(screen.getByRole('button', { name: copy.ACTIONS.restore }));
		expect(group('self_reuse')).toBeInTheDocument();
		expect(dismissed).toEqual([]);
	});
});
