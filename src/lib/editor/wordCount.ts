import type { Node as ProsemirrorNode } from '@tiptap/pm/model';

import { BIBLIOGRAPHY_NODE } from './extensions/citation/Bibliography';
import { NOTES_NODE } from './extensions/citation/Notes';

/**
 * Counting words the way a journal counts them.
 *
 * `Settings.svelte` has persisted a word-count target since before this work
 * began, and nothing ever read it, so the number a researcher is actually
 * writing to was invisible.
 *
 * The count that matters is the one the submission form asks for, and journals
 * almost always exclude the references from it — a paper at the limit on body
 * text can carry sixty citations without breaching anything. So the reference
 * list and the notes are counted separately rather than folded in. Reporting
 * one total would put authors over a limit they had not crossed.
 */

export interface WordCount {
	/** Words a journal's limit applies to. */
	body: number;
	/** Words in the works-cited list and the notes, usually excluded. */
	references: number;
	/** Everything, for a thesis or a chapter where the limit covers the lot. */
	total: number;
	characters: number;
}

/**
 * Words in a string.
 *
 * Split on whitespace rather than matched as letters, because a hyphenated
 * compound is one word, an em-dash-joined pair is two, and "et al." is two —
 * which is how a person counts, and how Word does.
 */
export function countWords(text: string): number {
	const trimmed = text.trim();
	if (trimmed.length === 0) return 0;

	return trimmed.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** citeproc emits HTML; words are counted in what a reader would see. */
function stripHtml(html: string): string {
	return html.replace(/<[^>]+>/g, ' ');
}

/** Count a document, keeping the reference apparatus separate. */
export function countDocument(doc: ProsemirrorNode): WordCount {
	let bodyText = '';
	let referenceText = '';

	doc.descendants((node) => {
		if (node.type.name === BIBLIOGRAPHY_NODE) {
			// The entries are attributes, not child nodes, so `textContent` is empty
			// here — reading it would silently report zero reference words.
			const entries: string[] = node.attrs.entries ?? [];
			referenceText += ` ${entries.map(stripHtml).join(' ')}`;
			return false;
		}

		if (node.type.name === NOTES_NODE) {
			const notes: Array<{ text: string }> = node.attrs.notes ?? [];
			referenceText += ` ${notes.map((n) => stripHtml(n.text)).join(' ')}`;
			return false;
		}

		if (node.isText) bodyText += ` ${node.text ?? ''}`;
		return true;
	});

	const body = countWords(bodyText);
	const references = countWords(referenceText);

	return {
		body,
		references,
		total: body + references,
		characters: bodyText.trim().length
	};
}

/**
 * The body words of a document as saved: its JSON, not a ProseMirror node.
 *
 * What a snapshot is labelled with (M5-1). The words are counted from what was
 * written to disk rather than from the editor, which may have moved on while
 * the save was under way, and the History view counts a file it has no editor
 * for. The same words as `countDocument(...).body`: the reference list and the
 * notes are left out.
 */
export function countSavedWords(doc: unknown): number {
	let text = '';
	const visit = (node: unknown) => {
		if (typeof node !== 'object' || node === null) return;
		const {
			type,
			text: own,
			content
		} = node as {
			type?: unknown;
			text?: unknown;
			content?: unknown;
		};
		if (type === BIBLIOGRAPHY_NODE || type === NOTES_NODE) return;
		if (type === 'text' && typeof own === 'string') text += ` ${own}`;
		if (Array.isArray(content)) content.forEach(visit);
	};
	visit(doc);
	return countWords(text);
}

/**
 * How the count reads next to a target.
 *
 * A target is something to reach as often as it is something not to exceed — a
 * thesis chapter has a minimum, a journal a maximum — so this reports distance
 * without assuming which, and leaves the wording to the caller.
 */
export function progressTo(count: number, target: number): { fraction: number; remaining: number } {
	if (!Number.isFinite(target) || target <= 0) return { fraction: 0, remaining: 0 };

	return {
		fraction: Math.min(count / target, 1),
		remaining: target - count
	};
}
