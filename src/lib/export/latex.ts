import type { JSONContent } from '@tiptap/core';

import { parseCitationIds } from '$lib/citations/document';
import { BIBLIOGRAPHY_NODE } from '$lib/editor/extensions/citation/Bibliography';
import { NOTES_NODE } from '$lib/editor/extensions/citation/Notes';
import { PAGE_BREAK_NODE } from '$lib/editor/extensions/PageBreak';

/**
 * A manuscript as LaTeX.
 *
 * Journals routinely ask for `.tex` alongside the PDF, and some supply a class
 * file the paper must be built with. A researcher who cannot produce one has to
 * retype the paper, so this exists to make the export a file rather than an
 * afternoon.
 *
 * The citations become `\\cite{key}` and the sources a `.bib`, rather than
 * pre-rendered text: handing a journal frozen citation strings defeats the
 * point of sending LaTeX, since their class file expects to format them itself.
 */

/**
 * Characters that mean something to TeX.
 *
 * Getting this wrong does not merely fail to compile — `50% of trials` silently
 * becomes `50` with the rest of the line commented out, and the author finds out
 * from a proof.
 *
 * One pass over the string, not one pass per character class. Replacing
 * sequentially cannot be made correct by ordering: the backslash has to go
 * first, but its replacement `\textbackslash{}` contains braces, which the
 * later brace rule then escapes into `\textbackslash\{\}`. A single scan
 * replaces each character exactly once and never re-reads its own output.
 */
const ESCAPES: Record<string, string> = {
	'\\': '\\textbackslash{}',
	'&': '\\&',
	'%': '\\%',
	$: '\\$',
	'#': '\\#',
	_: '\\_',
	'{': '\\{',
	'}': '\\}',
	'~': '\\textasciitilde{}',
	'^': '\\textasciicircum{}'
};

export function escapeLatex(text: string): string {
	return text.replace(/[\\&%$#_{}~^]/g, (character) => ESCAPES[character] ?? character);
}

export interface LatexOptions {
	title?: string;
	author?: string;
	/** Class the journal requires. `article` unless they say otherwise. */
	documentClass?: string;
	/** Base name of the `.bib`, without extension. */
	bibliographyName?: string;
	/** sha256 → citation key, from the bibliography export. */
	citationKeys?: Record<string, string>;
	/**
	 * The page as the author set it up.
	 *
	 * Without this the `.tex` compiles to `article`'s defaults — US Letter,
	 * roughly 1.9in margins, single-spaced — so the same manuscript exported two
	 * ways came out as two different documents. A co-author opening the bundle
	 * in Overleaf would see something the author never saw.
	 */
	page?: LatexPageSetup;
}

/** The subset of the page setup LaTeX can express. */
export interface LatexPageSetup {
	/** `letterpaper`, `a4paper`, `legalpaper` — a documentclass option. */
	paperOption: string;
	marginInches: number;
	/** Unitless multiplier. 1.15 and below is treated as single. */
	spacing: number;
}

const MARKS: Record<string, (inner: string) => string> = {
	bold: (s) => `\\textbf{${s}}`,
	italic: (s) => `\\textit{${s}}`,
	underline: (s) => `\\underline{${s}}`,
	strike: (s) => `\\sout{${s}}`,
	code: (s) => `\\texttt{${s}}`,
	superscript: (s) => `\\textsuperscript{${s}}`,
	subscript: (s) => `\\textsubscript{${s}}`,
	highlight: (s) => `\\hl{${s}}`
};

function applyMarks(text: string, marks: JSONContent['marks']): string {
	if (!marks?.length) return text;

	return marks.reduce((inner, mark) => {
		if (mark.type === 'link') {
			const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
			// \url would re-escape its argument, so the href is passed through
			// \href which takes it verbatim.
			return href ? `\\href{${href}}{${inner}}` : inner;
		}
		return MARKS[mark.type]?.(inner) ?? inner;
	}, text);
}

const HEADINGS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];

function serialize(node: JSONContent, options: LatexOptions): string {
	const children = () => (node.content ?? []).map((child) => serialize(child, options)).join('');

	switch (node.type) {
		case 'doc':
			return children();

		case 'text':
			return applyMarks(escapeLatex(node.text ?? ''), node.marks);

		case 'paragraph':
			return `${children()}\n\n`;

		case 'heading': {
			const level = Number(node.attrs?.level ?? 1);
			// LaTeX runs out of sectioning commands below subparagraph, so deeper
			// headings collapse rather than emitting an undefined control sequence.
			const command = HEADINGS[Math.min(level, HEADINGS.length) - 1];
			return `\\${command}{${children()}}\n\n`;
		}

		case 'bulletList':
			return `\\begin{itemize}\n${children()}\\end{itemize}\n\n`;

		case 'orderedList':
			return `\\begin{enumerate}\n${children()}\\end{enumerate}\n\n`;

		case 'listItem':
			return `  \\item ${children().trim()}\n`;

		case 'blockquote':
			return `\\begin{quote}\n${children().trim()}\n\\end{quote}\n\n`;

		case 'codeBlock':
			// verbatim takes its content literally, so the text must not be escaped.
			return `\\begin{verbatim}\n${textOf(node)}\n\\end{verbatim}\n\n`;

		case 'horizontalRule':
			return '\\par\\noindent\\hrulefill\\par\n\n';

		case 'hardBreak':
			return '\\\\\n';

		case 'image': {
			const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
			if (!src) return '';
			return `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=\\linewidth]{${src}}\n\\end{figure}\n\n`;
		}

		case 'table':
			return serializeTable(node, options);

		case 'citation': {
			const ids = parseCitationIds(node.attrs?.id);
			const keys = ids.map((id) => options.citationKeys?.[id]).filter((k): k is string => !!k);

			// A citation whose source is gone becomes a visible marker rather than
			// an empty \cite{}, which LaTeX renders as a silent "[?]".
			if (keys.length === 0) return '\\textbf{[source removed]}';

			return `\\cite{${keys.join(',')}}`;
		}

		case PAGE_BREAK_NODE:
			return '\\clearpage\n\n';

		case BIBLIOGRAPHY_NODE:
			// The class file formats the references from the .bib. Emitting the
			// rendered entries would freeze them in Erti's chosen CSL style and
			// override whatever the journal asked for.
			return `\\bibliographystyle{plain}\n\\bibliography{${options.bibliographyName ?? 'references'}}\n\n`;

		case NOTES_NODE:
			// Notes in LaTeX belong at their citation points as \footnote, which is
			// a document-wide restructuring rather than a node to emit here.
			return '';

		default:
			return children();
	}
}

function textOf(node: JSONContent): string {
	if (node.type === 'text') return node.text ?? '';
	return (node.content ?? []).map(textOf).join('');
}

function serializeTable(node: JSONContent, options: LatexOptions): string {
	const rows = node.content ?? [];
	const columns = rows[0]?.content?.length ?? 0;
	if (columns === 0) return '';

	const body = rows
		.map((row) =>
			(row.content ?? [])
				.map((cell) =>
					(cell.content ?? [])
						.map((child) => serialize(child, options))
						.join('')
						.trim()
				)
				.join(' & ')
		)
		.join(' \\\\\n  \\hline\n  ');

	return `\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{|${'l|'.repeat(columns)}}\n  \\hline\n  ${body} \\\\\n  \\hline\n  \\end{tabular}\n\\end{table}\n\n`;
}

/** The manuscript body, without a preamble. */
export function toLatexBody(doc: JSONContent, options: LatexOptions = {}): string {
	return serialize(doc, options)
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** A complete, compilable `.tex`. */
export function toLatexDocument(doc: JSONContent, options: LatexOptions = {}): string {
	const { title, author, documentClass = 'article', page } = options;

	// The paper goes as a class option rather than through geometry, because a
	// journal's own class reads it there and some ignore geometry entirely.
	const classOptions = page ? `[${page.paperOption}]` : '';

	// Only what the body can actually need. A preamble full of unused packages is
	// the first thing a journal's class file collides with.
	const preamble = [
		`\\documentclass${classOptions}{${documentClass}}`,
		'\\usepackage[utf8]{inputenc}',
		'\\usepackage[T1]{fontenc}',
		'\\usepackage{graphicx}',
		'\\usepackage{hyperref}',
		'\\usepackage[normalem]{ulem}',
		'\\usepackage{soul}'
	];

	if (page) {
		// article's default margin is close to 1.9in, which is nobody's
		// submission requirement and not what the author saw on screen.
		preamble.push(`\\usepackage[margin=${page.marginInches}in]{geometry}`);

		// setspace only when it is doing something. Single is the default, and an
		// unused package is one more thing to collide with a journal's class file.
		if (page.spacing > 1.15) {
			preamble.push('\\usepackage{setspace}');
			preamble.push(page.spacing >= 2 ? '\\doublespacing' : '\\onehalfspacing');
		}
	}

	if (title) preamble.push(`\\title{${escapeLatex(title)}}`);
	if (author) preamble.push(`\\author{${escapeLatex(author)}}`);

	const opening = title ? '\\maketitle\n\n' : '';

	return `${preamble.join('\n')}

\\begin{document}

${opening}${toLatexBody(doc, options)}

\\end{document}
`;
}
