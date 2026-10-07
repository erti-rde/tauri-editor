import type { Annotation, AnnotationLabel, SourceNote } from '$lib/stores/db';

/** A source note as the export is given it, with its work's name when known. */
export type NamedSourceNote = SourceNote & { title?: string | null };
import { guardSidecar, LimitError } from '$lib/guard';

/**
 * Notes, on their way out.
 *
 * Two shapes, for two different reasons. Markdown is what a researcher actually
 * wants — something to paste into a supervision meeting, a reading group, or
 * their own draft. JSON is the escape hatch: complete, re-importable, and the
 * reason none of this is locked inside Erti.
 *
 * Neither touches the PDF. Writing marks into the file would change its bytes,
 * and the whole library is keyed on the SHA-256 of those bytes — every source,
 * chunk and citation would re-key on each save.
 */

export interface ExportSource {
	sha256: string;
	/** How the paper should be named in a heading. */
	title: string;
}

function labelName(labels: AnnotationLabel[], id: string | null): string | null {
	return labels.find((label) => label.id === id)?.name ?? null;
}

/**
 * Notes grouped by paper, in reading order: the notes on the work as a whole,
 * then its marks by page, as its Notes tab lists them.
 *
 * Grouped rather than listed flat because notes are read back one paper at a
 * time — "what did I get out of Smith" is the question, not "what did I write
 * last Tuesday".
 */
export function toMarkdown(
	annotations: Annotation[],
	sources: ExportSource[],
	labels: AnnotationLabel[],
	resolve: (id: string) => string = (id) => id,
	sourceNotes: NamedSourceNote[] = []
): string {
	const byPaper = new Map<string, { notes: NamedSourceNote[]; marks: Annotation[] }>();
	const groupOf = (work: string) => {
		const group = byPaper.get(work) ?? { notes: [], marks: [] };
		byPaper.set(work, group);
		return group;
	};

	// A note is kept on its work. A mark sits on its file's hash, and a project
	// lists works (ADR 003), so a mark on a PDF attached to a book is filed
	// under the book.
	for (const note of sourceNotes) groupOf(resolve(note.sha256)).notes.push(note);
	for (const annotation of annotations) groupOf(resolve(annotation.sha256)).marks.push(annotation);

	const lines: string[] = ['# Notes', ''];

	for (const [sha256, { notes, marks }] of byPaper) {
		const source = sources.find((candidate) => candidate.sha256 === sha256);
		// The sources are the open project's and the notes the library's, so a
		// work elsewhere is named by its notes, which carry its name.
		const title = source?.title ?? notes.find((note) => note.title)?.title;
		lines.push(`## ${title ?? 'Unknown paper'}`, '');

		for (const note of notes) {
			const page = note.page_label?.trim();
			const heading = [labelName(labels, note.label_id), page && `p. ${page}`]
				.filter(Boolean)
				.join(' · ');
			lines.push(`**${heading || 'Note'}**`, '');

			// Transcribed by hand, so its lines are the writer's own and kept.
			if (note.quote) lines.push(...note.quote.split('\n').map((line) => `> ${line}`), '');
			if (note.body) lines.push(note.body, '');
		}

		for (const mark of [...marks].sort((a, b) => a.page - b.page)) {
			const label = labelName(labels, mark.label_id);
			// The printed page, so a quotation lifted out of here can be cited as
			// it stands.
			const heading = [label, `p. ${mark.page_label?.trim() || mark.page}`]
				.filter(Boolean)
				.join(' · ');

			lines.push(`**${heading}**`, '');

			if (mark.quote) {
				// Quoted as a blockquote, and the paper's words are kept separate
				// from the reader's: which is which stops being obvious the moment
				// they are run together.
				lines.push(`> ${mark.quote.replace(/\n+/g, ' ')}`, '');
			}

			if (mark.note) lines.push(mark.note, '');
			if (mark.origin === 'imported') lines.push('_Imported from another tool._', '');
		}
	}

	return lines.join('\n').trimEnd() + '\n';
}

/**
 * The complete records, re-importable, ids and all.
 *
 * Source notes ride in a field of their own, and the version stays 1: a field
 * is added, none is repurposed, so a reader written before notes on a source
 * reads the marks and passes over the rest.
 */
export function toSidecar(annotations: Annotation[], sourceNotes: NamedSourceNote[] = []): string {
	return JSON.stringify(
		{
			// Versioned so a reader written later can tell what it is looking at.
			format: 'erti-annotations',
			version: 1,
			exported_at: new Date().toISOString(),
			annotations,
			// The records as kept: a work's name is read from the work, not the note.
			source_notes: sourceNotes.map(({ title: _title, ...note }) => note)
		},
		null,
		2
	);
}

/** What a sidecar carries, once it has been read back. */
export interface Sidecar {
	format: string;
	version: number;
	annotations: Annotation[];
	/** Empty for a file written before notes on a source. */
	source_notes: SourceNote[];
}

/**
 * Read a sidecar, refusing anything that is not one.
 *
 * Returns null rather than throwing, and never half-imports: a file that is not
 * what it claims should leave the library exactly as it was.
 */
export function parseSidecar(text: string): Sidecar | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	try {
		// Fields are allowlisted and sized, and every record has to carry what a
		// mark can't be drawn without (M1b-10). A file over the size limit is
		// refused with a message, rather than reported as not being a sidecar.
		return guardSidecar(parsed) as unknown as Sidecar;
	} catch (error) {
		if (error instanceof LimitError) throw error;
		return null;
	}
}
