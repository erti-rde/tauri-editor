import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { BIBLIOGRAPHY_NODE } from '$lib/editor/extensions/citation/Bibliography';

/**
 * What the document currently contains, as far as references are concerned.
 *
 * Separated from the decision in `autoReferences.ts` so that the rule about
 * when to add a list can be tested without building a ProseMirror document,
 * and this can be checked against a real one.
 */

const CITATION_NODE = 'citation';

export interface DocumentShape {
	hasCitations: boolean;
	hasBibliography: boolean;
}

/**
 * Walks until it has both answers.
 *
 * `descendants` has no early exit, so the callback returning `false` is what
 * stops it recursing — worth doing, because this runs on a manuscript that may
 * be hundreds of pages and only needs to find two things.
 */
export function readDocumentShape(doc: ProseMirrorNode): DocumentShape {
	let hasCitations = false;
	let hasBibliography = false;

	doc.descendants((node) => {
		if (hasCitations && hasBibliography) return false;

		if (node.type.name === CITATION_NODE) hasCitations = true;
		else if (node.type.name === BIBLIOGRAPHY_NODE) hasBibliography = true;

		// A citation is inline and a bibliography is an atom; neither contains
		// anything this needs to look inside.
		return !(node.type.name === CITATION_NODE || node.type.name === BIBLIOGRAPHY_NODE);
	});

	return { hasCitations, hasBibliography };
}
