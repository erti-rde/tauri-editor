import { findDoi } from '$lib/ingest/identifiers';
import { lookupDoi } from '$lib/ingest/resolve';
import { networkAllowed } from '$lib/stores/consent';
import { addSourceFromDoi, addToProject, sourceForDoi } from '$lib/stores/db';

import type { AugmentedZoteroSchema } from './adapterCslZotero';
import { newSourceId } from './sourceForm';

export type FromDoi =
	/** Nothing in what was typed looks like a DOI. */
	| { kind: 'not-a-doi' }
	/** The library has it already, and the project now does too (AC-3). */
	| { kind: 'existing'; id: string }
	/** Not looked up: lookups are off (AC-2), or the details are to be typed. */
	| { kind: 'by-hand'; doi: string }
	/** doi.org had nothing citable for it, or couldn't be reached. */
	| { kind: 'not-found'; doi: string }
	| { kind: 'added'; id: string; title: string };

/**
 * Add a source from its DOI (M1b-6, docs/ux.md UX-2).
 *
 * The library is asked first, so a DOI it has already opens that source,
 * lookups on or off, and nothing about it goes to doi.org. Otherwise it's
 * looked up, and kept as a work with no file, as one entered by hand is.
 * With `lookUp` false it's only checked against the library, for the details
 * to be entered by hand.
 */
export async function addFromDoi(
	input: string,
	schema: AugmentedZoteroSchema,
	{ lookUp = true }: { lookUp?: boolean } = {}
): Promise<FromDoi> {
	const doi = findDoi(input);
	if (!doi) return { kind: 'not-a-doi' };

	const known = await sourceForDoi(doi);
	if (known) return existing(known);
	if (!lookUp || !(await networkAllowed())) return { kind: 'by-hand', doi };

	const resolved = await lookupDoi(doi);
	if (!resolved) return { kind: 'not-found', doi };

	// doi.org answers for a DOI by any case, and with its own: that one may be
	// in the library when what was typed wasn't.
	const registered = resolved.doi ?? doi;
	if (registered.toLowerCase() !== doi) {
		const alsoKnown = await sourceForDoi(registered);
		if (alsoKnown) return existing(alsoKnown);
	}

	const id = newSourceId();
	const csl: Record<string, unknown> = { ...resolved.csl, id, DOI: registered };
	// Crossref's reference list is every work the paper cites: kilobytes the
	// library would carry for no citation.
	delete csl.reference;
	if (Array.isArray(csl.title)) csl.title = String(csl.title[0]);
	// A kind the form knows, so the sidebar shows its fields; a record of some
	// other kind is kept as a document rather than refused.
	let zoteroType = schema.cslToZoteroTypeMap.get(String(csl.type ?? ''));
	if (!zoteroType) {
		csl.type = 'document';
		zoteroType = 'document';
	}
	csl.zotero_type = zoteroType;

	await addSourceFromDoi(id, JSON.stringify(csl), zoteroType);
	return { kind: 'added', id, title: String(csl.title) };
}

async function existing(id: string): Promise<FromDoi> {
	// Already this project's, this changes nothing.
	await addToProject(id);
	return { kind: 'existing', id };
}
