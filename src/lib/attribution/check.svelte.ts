import { describeError } from '$lib/ipc';
import { log } from '$lib/log';
import { showInPdf } from '$lib/pdfreader/showInPdf';
import { citationStore } from '$lib/stores/citationStore';
import {
	checkAttribution,
	dismissedFindings,
	dismissFinding,
	libraryWorks,
	restoreFinding,
	type DismissedFinding
} from '$lib/stores/db';
import { errorToast } from '$lib/toast/Toast.svelte';
import type { CheckEditor } from '$lib/editor/checkEditor';
import type { AttributionMatches } from '$lib/ipc';

import {
	classify,
	FINDING_KINDS,
	type CheckedSentence,
	type Finding,
	type FindingKind
} from './classify';
import * as copy from './copy';
import {
	anyLongEnough,
	excerpt,
	findingId,
	pageOf,
	quotationOf,
	sentenceHash,
	shortName,
	sourceSays,
	sourceWordsFor,
	toChecked,
	wordsAsWritten
} from './findings';

/**
 * The attribution check, for the Check panel (M4-5 to M4-7, docs/ux.md UX-7).
 *
 * It runs only when asked (AC-6): nothing here is called on opening a
 * document or a project. The editor attaches a bridge while a manuscript is
 * open; the panel reads what's here and calls the actions.
 */

export type FixAction = 'quoteAndCite' | 'cite' | 'blockQuote' | 'useSourceWords';

/** A finding as the panel shows it. */
export interface ShownFinding extends Finding {
	id: string;
	/** The sentence as it was checked, which a fix requires it still to be. */
	checked: CheckedSentence;
	/** What a dismissal is stored under (M4-7). */
	hash: string;
	/** The sentence's matched words, with ellipses where it goes on. */
	excerpt: string;
	/** The work by its authors and year, or the document's name. */
	source: string;
	page: string | null;
	/** What differs, or which work it was cited to. */
	detail: string | null;
	/** The fixes that fit it (M4-6 AC-1). */
	fixes: FixAction[];
	/** The passage's words that matched, as written, for marking it in the PDF. */
	quote: string | null;
}

export interface CheckResult {
	/** The manuscript checked, by file name. */
	document: string | null;
	sentences: number;
	sources: number;
	documents: number;
	/** No sentence was long enough to compare, so nothing was read. */
	tooShort: boolean;
	findings: ShownFinding[];
}

/** A sentence long enough for a block quotation, as style guides set it. */
const BLOCK_QUOTE_WORDS = 40;

const keyOf = (d: DismissedFinding) => `${d.sentenceHash}\u0000${d.canonicalId}\u0000${d.kind}`;
const dismissalOf = (f: ShownFinding): DismissedFinding => ({
	sentenceHash: f.hash,
	canonicalId: f.work,
	kind: f.kind
});

/** A document's name without the format's extension. */
const documentName = (file: string) => file.replace(/\.erti\.json$/, '').replace(/\.json$/, '');

class AttributionCheck {
	/** The open manuscript's bridge, while there is one. */
	editor = $state.raw<CheckEditor | null>(null);
	/** Which manuscript is open, by file name. */
	document = $state<string | null>(null);
	running = $state(false);
	failure = $state<string | null>(null);
	result = $state.raw<CheckResult | null>(null);
	/** The document has changed since the check (AC-5). */
	stale = $state(false);
	selected = $state<string | null>(null);
	/** The finding a fix is being made to. */
	fixing = $state<string | null>(null);
	dismissed = $state.raw<DismissedFinding[]>([]);

	/** Where each finding's sentence was when the editor last let go of it. */
	private ranges = new Map<string, { from: number; to: number }>();
	/** Which run is the latest: an older one's answer is dropped. */
	private generation = 0;

	/** The result for the open manuscript, if the last check was of it. */
	get current(): CheckResult | null {
		return this.result && this.result.document === this.document ? this.result : null;
	}

	isDismissed(finding: ShownFinding): boolean {
		const key = keyOf(dismissalOf(finding));
		return this.dismissed.some((d) => keyOf(d) === key);
	}

	/** The findings to show and the dismissed ones, each in kind order. */
	get groups(): { kind: FindingKind; findings: ShownFinding[] }[] {
		const findings = this.current?.findings ?? [];
		return FINDING_KINDS.map((kind) => ({
			kind,
			findings: findings.filter((f) => f.kind === kind && !this.isDismissed(f))
		})).filter((group) => group.findings.length > 0);
	}

	get dismissedFindings(): ShownFinding[] {
		return (this.current?.findings ?? []).filter((f) => this.isDismissed(f));
	}

	/* ------------------------------------------------------------ editor */

	/**
	 * A manuscript's editor is ready. Built afresh each time it's shown, so the
	 * findings of the same document are marked again where they last were.
	 */
	attach(editor: CheckEditor) {
		this.editor = editor;
		this.document = editor.document();
		if (this.current && this.ranges.size > 0) {
			editor.mark([...this.ranges].map(([id, range]) => ({ id, ...range })));
			this.ranges.clear();
		}
	}

	/** The editor is going: keep where its findings were, for the next one. */
	detach(editor: CheckEditor) {
		if (this.editor !== editor) return;
		this.ranges.clear();
		for (const finding of this.current?.findings ?? []) {
			const range = editor.rangeOf(finding.id);
			if (range) this.ranges.set(finding.id, range);
		}
		this.editor = null;
		this.document = null;
		this.selected = null;
	}

	/** The editor switched manuscripts. One checked before can't be marked again. */
	opened(document: string | null) {
		if (document === this.document) return;
		this.document = document;
		this.selected = null;
		this.ranges.clear();
		if (this.result?.document === document) this.stale = true;
	}

	/** The writer changed the document (AC-5). A fix's own edits don't count. */
	edited() {
		if (this.editor?.fixing) return;
		if (this.current) this.stale = true;
	}

	/* --------------------------------------------------------------- run */

	/** Check the open manuscript (AC-6: only ever when asked). */
	async run() {
		const editor = this.editor;
		if (!editor || this.running) return;
		const ticket = ++this.generation;
		this.running = true;
		this.failure = null;
		this.selected = null;
		editor.select(null);

		try {
			const document = editor.document();
			const sentences = editor.sentences();
			const checked = sentences.map((s) => toChecked(s, (id) => citationStore.canonicalId(id)));

			if (!anyLongEnough(checked)) {
				editor.mark([]);
				this.finish(ticket, {
					document,
					sentences: sentences.length,
					sources: 0,
					documents: 0,
					tooShort: true,
					findings: []
				});
				return;
			}

			const [matches, names, dismissed] = await Promise.all([
				checkAttribution(
					document,
					checked.map((s) => s.text)
				),
				this.names(),
				dismissedFindings().catch((thrown) => {
					// Dismissals failing to load shouldn't stop the check: the
					// findings show, dismissed or not, and the failure is logged.
					log.error('Could not read dismissed findings', thrown);
					return [] as DismissedFinding[];
				})
			]);
			if (ticket !== this.generation) return;

			const findings = await this.show(checked, matches, names);
			if (ticket !== this.generation) return;

			editor.mark(
				findings.map((f) => ({
					id: f.id,
					from: sentences[f.sentence].from,
					to: sentences[f.sentence].to
				}))
			);
			this.dismissed = dismissed;
			this.finish(ticket, {
				document,
				sentences: sentences.length,
				sources: matches.sources,
				documents: matches.documents,
				tooShort: false,
				findings
			});
		} catch (thrown) {
			if (ticket !== this.generation) return;
			log.error('Could not check attribution', thrown);
			this.failure = describeError(thrown);
			this.running = false;
		}
	}

	private finish(ticket: number, result: CheckResult) {
		if (ticket !== this.generation) return;
		this.result = result;
		this.stale = false;
		this.running = false;
		this.ranges.clear();
	}

	/** Every work's short name, by canonical id. */
	private async names(): Promise<Map<string, string>> {
		try {
			const works = await libraryWorks();
			return new Map(
				works.flatMap((work) => {
					const name = shortName(work.csl_json);
					return name ? [[work.id, name] as const] : [];
				})
			);
		} catch (thrown) {
			log.error('Could not name the sources', thrown);
			return new Map();
		}
	}

	/** Findings for these sentences, with what the panel shows of each. */
	private async show(
		checked: CheckedSentence[],
		matches: AttributionMatches,
		names: Map<string, string>,
		indexOf: (sentence: number) => number = (i) => i
	): Promise<ShownFinding[]> {
		const nameOf = (work: string) => names.get(work) ?? copy.UNKNOWN_SOURCE;
		const findings = classify(checked, matches);
		return Promise.all(
			findings.map(async (finding) => {
				const sentence = checked[finding.sentence];
				const { span, passage } = finding;
				const document = passage.kind === 'document';
				const quote = wordsAsWritten(passage.text, span.passageWords);

				let detail: string | null = null;
				if (finding.kind === 'drifted_quote') {
					detail = copy.SOURCE_SAYS(sourceSays(sentence, span, passage));
				} else if (finding.kind === 'wrong_source') {
					detail = copy.CITED_TO(sentence.cites.map(nameOf).join(', '));
				} else if (finding.kind === 'uncited') {
					detail = (span.verbatimScore ?? 0) >= 1 ? copy.SAME_WORDS : copy.SIMILAR_WORDS;
				}

				const shown: ShownFinding = {
					...finding,
					sentence: indexOf(finding.sentence),
					id: findingId({ ...finding, sentence: indexOf(finding.sentence) }),
					checked: sentence,
					hash: await sentenceHash(sentence.text),
					excerpt: excerpt(sentence.text, span.sentenceWords),
					source: document ? documentName(passage.work) : nameOf(passage.work),
					page: document ? null : pageOf(passage),
					detail,
					fixes: fixesFor(finding, sentence),
					quote
				};
				return shown;
			})
		);
	}

	/* ----------------------------------------------------------- actions */

	/**
	 * Look at a finding: its sentence underlined in the manuscript and its
	 * source open beside it, at the page, with the passage marked (AC-4).
	 */
	select(finding: ShownFinding | null) {
		this.selected = finding?.id ?? null;
		this.editor?.select(this.selected);
		if (finding) void this.showSource(finding);
	}

	async showSource(finding: ShownFinding) {
		const { passage } = finding;
		if (!passage.file) return;
		await showInPdf(
			{
				sha256: passage.file,
				page: passage.page ?? 1,
				selector: finding.quote ? { quote: finding.quote } : undefined
			},
			{ beside: true }
		);
	}

	/**
	 * Make a fix, then check that sentence again (M4-6 AC-2): the finding
	 * clears if the fix answered it, and stays, updated, if it didn't.
	 */
	async fix(finding: ShownFinding, action: FixAction) {
		const editor = this.editor;
		if (!editor || this.fixing) return;
		this.fixing = finding.id;
		try {
			const made = await this.make(editor, finding, action);
			if (!made) {
				errorToast(copy.FIX_FAILED);
				return;
			}
			await this.recheck(editor, finding);
		} catch (thrown) {
			log.error('Could not make that fix', thrown);
			errorToast(copy.FIX_FAILED);
		} finally {
			this.fixing = null;
		}
	}

	private async make(editor: CheckEditor, finding: ShownFinding, action: FixAction) {
		const { id, checked, span, passage, work } = finding;
		const page = passage.kind === 'document' ? undefined : (pageOf(passage) ?? undefined);
		switch (action) {
			case 'cite':
				return editor.cite(id, checked.text, work, page);
			case 'quoteAndCite':
				return editor.quoteAndCite(id, checked.text, span.sentenceWords, work, page);
			case 'blockQuote':
				return editor.blockQuote(id, checked.text, work, page);
			case 'useSourceWords': {
				const quotation = quotationOf(checked, span);
				const words = quotation && sourceWordsFor(checked.text, quotation.words, span, passage);
				if (!quotation || !words) return false;
				return editor.replace(id, checked.text, quotation.at, words);
			}
		}
	}

	/** Check one sentence again and put its findings in place of the old. */
	private async recheck(editor: CheckEditor, finding: ShownFinding) {
		const result = this.result;
		const sentence = editor.sentenceOf(finding.id);
		if (!result || !sentence) return;

		const checked = toChecked(sentence, (id) => citationStore.canonicalId(id));
		const [matches, names] = await Promise.all([
			checkAttribution(result.document, [checked.text]),
			this.names()
		]);
		const fresh = await this.show([checked], matches, names, () => finding.sentence);
		if (this.result !== result) return;

		const findings = [
			...result.findings.filter((f) => f.sentence !== finding.sentence),
			...fresh
		].sort((a, b) => a.sentence - b.sentence);
		const ranges = findings.flatMap((f) => {
			const range = f.sentence === finding.sentence ? sentence : editor.rangeOf(f.id);
			return range ? [{ id: f.id, from: range.from, to: range.to }] : [];
		});
		editor.mark(ranges);
		this.selected = null;
		this.result = { ...result, findings };
	}

	/** Set a finding aside, for this project, until its words change (M4-7). */
	async dismiss(finding: ShownFinding) {
		try {
			await dismissFinding(dismissalOf(finding));
			this.dismissed = [...this.dismissed, dismissalOf(finding)];
			if (this.selected === finding.id) this.select(null);
		} catch (thrown) {
			log.error('Could not dismiss that finding', thrown);
			errorToast(describeError(thrown));
		}
	}

	async restore(finding: ShownFinding) {
		try {
			await restoreFinding(dismissalOf(finding));
			const key = keyOf(dismissalOf(finding));
			this.dismissed = this.dismissed.filter((d) => keyOf(d) !== key);
		} catch (thrown) {
			log.error('Could not restore that finding', thrown);
			errorToast(describeError(thrown));
		}
	}

	/** Nothing open: a project closed, or the app reset. */
	reset() {
		this.generation++;
		this.editor = null;
		this.document = null;
		this.running = false;
		this.failure = null;
		this.result = null;
		this.stale = false;
		this.selected = null;
		this.fixing = null;
		this.dismissed = [];
		this.ranges.clear();
	}
}

/**
 * The fixes that fit a finding (M4-6 AC-1). Quoting is offered only where
 * the words aren't already quoted, a block quotation only for a long
 * sentence outside one, and the source's words only for a quotation in marks.
 */
export function fixesFor(finding: Finding, sentence: CheckedSentence): FixAction[] {
	switch (finding.kind) {
		case 'uncited': {
			if (sentence.quoted || quotationOf(sentence, finding.span)) return ['cite'];
			const long = finding.span.sharedWords >= BLOCK_QUOTE_WORDS;
			return long ? ['quoteAndCite', 'cite', 'blockQuote'] : ['quoteAndCite', 'cite'];
		}
		case 'wrong_source':
			return ['cite'];
		case 'drifted_quote':
			return quotationOf(sentence, finding.span) ? ['useSourceWords'] : [];
		case 'self_reuse':
			return [];
	}
}

export const attributionCheck = new AttributionCheck();
