import { Node, mergeAttributes } from '@tiptap/core';
import type { Command, RawCommands } from '@tiptap/core';

/**
 * A break the author places, and can see.
 *
 * Print rules alone decide where pages *may* break; they cannot say where a
 * page *must* end. A thesis needs a new page at each chapter, a paper needs the
 * references to start on their own page, and journals ask for figures and
 * tables after the text. None of that is expressible as a widow rule.
 *
 * It shows as a labelled line on screen because a break the author cannot see
 * is a break they will forget, and only find out about from the PDF.
 */

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		pageBreak: {
			insertPageBreak: () => ReturnType;
		};
	}
}

export const PAGE_BREAK_NODE = 'pageBreak';

export const PageBreak = Node.create({
	name: PAGE_BREAK_NODE,
	group: 'block',
	atom: true,
	selectable: true,
	draggable: false,

	parseHTML() {
		return [{ tag: `div[data-type="${this.name}"]` }];
	},

	renderHTML({ HTMLAttributes }) {
		// A div rather than an <hr>: a horizontal rule means a thematic break in
		// the text, which a screen reader would announce as content the author
		// did not write.
		return [
			'div',
			mergeAttributes(HTMLAttributes, {
				'data-type': this.name,
				class: 'page-break',
				role: 'separator',
				'aria-label': 'Page break'
			})
		];
	},

	renderText() {
		// Plain-text export has no pages, so the break is simply a blank line.
		return '\n';
	},

	addCommands() {
		return {
			insertPageBreak:
				(): Command =>
				({ chain }) =>
					chain().focus().insertContent({ type: PAGE_BREAK_NODE }).run()
		} as Partial<RawCommands>;
	},

	addKeyboardShortcuts() {
		return {
			// What Word and Google Docs both use, so it is already in the fingers of
			// anyone arriving from either.
			'Mod-Enter': () => this.editor.commands.insertPageBreak()
		};
	}
});
