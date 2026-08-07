import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';

import { escapeLatex, toLatexBody, toLatexDocument } from './latex';

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({
	type: 'text',
	text: t,
	marks
});

describe('escaping', () => {
	it('escapes a percent sign', () => {
		// The one that matters most: unescaped, "50% of trials" becomes "50" and
		// the rest of the line is a comment. The author finds out from a proof.
		expect(escapeLatex('50% of trials')).toBe('50\\% of trials');
	});

	it('escapes every character TeX reads as syntax', () => {
		expect(escapeLatex('&')).toBe('\\&');
		expect(escapeLatex('$')).toBe('\\$');
		expect(escapeLatex('#')).toBe('\\#');
		expect(escapeLatex('_')).toBe('\\_');
		expect(escapeLatex('{}')).toBe('\\{\\}');
		expect(escapeLatex('~')).toBe('\\textasciitilde{}');
		expect(escapeLatex('^')).toBe('\\textasciicircum{}');
	});

	it('does not escape the escapes it just introduced', () => {
		// The backslash is replaced first; doing it last would turn every `\&`
		// into `\textbackslash{}&` and break the whole document.
		expect(escapeLatex('\\')).toBe('\\textbackslash{}');
		expect(escapeLatex('a & b')).toBe('a \\& b');
		expect(escapeLatex('C:\\path_name')).toBe('C:\\textbackslash{}path\\_name');
	});

	it('leaves ordinary prose alone', () => {
		expect(escapeLatex('The effect was significant (p < 0.05).')).toBe(
			'The effect was significant (p < 0.05).'
		);
	});
});

describe('the manuscript body', () => {
	it('writes paragraphs', () => {
		expect(toLatexBody(doc(para(text('One.')), para(text('Two.'))))).toBe('One.\n\nTwo.');
	});

	it('maps headings to sectioning commands', () => {
		const out = toLatexBody(
			doc(
				{ type: 'heading', attrs: { level: 1 }, content: [text('Introduction')] },
				{ type: 'heading', attrs: { level: 2 }, content: [text('Method')] }
			)
		);

		expect(out).toContain('\\section{Introduction}');
		expect(out).toContain('\\subsection{Method}');
	});

	it('collapses a heading deeper than LaTeX can section', () => {
		// Below subparagraph there is nothing, and an undefined control sequence
		// stops the compile.
		const out = toLatexBody(doc({ type: 'heading', attrs: { level: 9 }, content: [text('Deep')] }));

		expect(out).toBe('\\subparagraph{Deep}');
	});

	it('applies marks', () => {
		expect(toLatexBody(doc(para(text('bold', [{ type: 'bold' }]))))).toBe('\\textbf{bold}');
		expect(toLatexBody(doc(para(text('it', [{ type: 'italic' }]))))).toBe('\\textit{it}');
	});

	it('nests marks', () => {
		const out = toLatexBody(doc(para(text('both', [{ type: 'bold' }, { type: 'italic' }]))));

		expect(out).toContain('both');
		expect(out).toContain('\\textbf');
		expect(out).toContain('\\textit');
	});

	it('escapes inside a mark', () => {
		expect(toLatexBody(doc(para(text('100%', [{ type: 'bold' }]))))).toBe('\\textbf{100\\%}');
	});

	it('writes lists', () => {
		const out = toLatexBody(
			doc({
				type: 'bulletList',
				content: [{ type: 'listItem', content: [para(text('First'))] }]
			})
		);

		expect(out).toContain('\\begin{itemize}');
		expect(out).toContain('\\item First');
	});

	it('leaves a code block unescaped', () => {
		// verbatim takes its content literally, so escaping would print the
		// escapes themselves.
		const out = toLatexBody(doc({ type: 'codeBlock', content: [text('if (a & b) { x_1 }')] }));

		expect(out).toContain('if (a & b) { x_1 }');
		expect(out).not.toContain('\\&');
	});

	it('writes a page break as a clearpage', () => {
		expect(toLatexBody(doc({ type: 'pageBreak' }))).toBe('\\clearpage');
	});
});

describe('citations', () => {
	const keys = { sha1: 'smith2020', sha2: 'okafor2019' };

	it('writes a cite command with the source key', () => {
		const out = toLatexBody(
			doc(
				para({ type: 'citation', attrs: { id: JSON.stringify(['sha1']), label: '(Smith, 2020)' } })
			),
			{ citationKeys: keys }
		);

		expect(out).toBe('\\cite{smith2020}');
	});

	it('writes one command for a multi-source citation', () => {
		const out = toLatexBody(
			doc(
				para({
					type: 'citation',
					attrs: { id: JSON.stringify(['sha1', 'sha2']), label: '(Smith, 2020; Okafor, 2019)' }
				})
			),
			{ citationKeys: keys }
		);

		expect(out).toBe('\\cite{smith2020,okafor2019}');
	});

	it('does not emit the rendered citation text', () => {
		// Handing a journal frozen citation strings defeats the point of sending
		// LaTeX: their class file expects to format them itself.
		const out = toLatexBody(
			doc(
				para({ type: 'citation', attrs: { id: JSON.stringify(['sha1']), label: '(Smith, 2020)' } })
			),
			{ citationKeys: keys }
		);

		expect(out).not.toContain('Smith, 2020');
	});

	it('marks a citation whose source is gone', () => {
		// An empty \cite{} renders as a silent "[?]" in the PDF.
		const out = toLatexBody(
			doc(para({ type: 'citation', attrs: { id: JSON.stringify(['missing']), label: 'x' } })),
			{ citationKeys: keys }
		);

		expect(out).toContain('[source removed]');
		expect(out).not.toContain('\\cite{}');
	});

	it('points the bibliography at the bib file rather than inlining entries', () => {
		const out = toLatexBody(
			doc({ type: 'bibliography', attrs: { entries: ['Smith, A. 2020.'] } }),
			{
				bibliographyName: 'references'
			}
		);

		expect(out).toContain('\\bibliography{references}');
		expect(out).not.toContain('Smith, A. 2020.');
	});
});

describe('a complete document', () => {
	it('compiles-shaped: preamble, begin, end', () => {
		const out = toLatexDocument(doc(para(text('Body.'))));

		expect(out).toContain('\\documentclass{article}');
		expect(out.indexOf('\\begin{document}')).toBeLessThan(out.indexOf('Body.'));
		expect(out.trimEnd().endsWith('\\end{document}')).toBe(true);
	});

	it('uses the class a journal requires', () => {
		expect(toLatexDocument(doc(), { documentClass: 'elsarticle' })).toContain(
			'\\documentclass{elsarticle}'
		);
	});

	it('escapes the title', () => {
		expect(toLatexDocument(doc(), { title: 'Cost & Benefit' })).toContain(
			'\\title{Cost \\& Benefit}'
		);
	});

	it('omits maketitle when there is no title', () => {
		expect(toLatexDocument(doc(para(text('x'))))).not.toContain('\\maketitle');
	});
});
