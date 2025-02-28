import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';

import type { Command, CommandProps, RawCommands } from '@tiptap/core';

export interface CitationAttrs {
	id: string | null;
	text: string | null;
}

export const CitationPluginKey = new PluginKey('citation');

export const Citation = Extension.create({
	name: 'citation',

	addCommands() {
		return {
			insertCitation:
				(attrs: CitationAttrs): Command =>
				({ chain, state }: CommandProps) => {
					const pos = state.selection.to;
					const { doc } = state;

					// Check if we need to add a space before the citation
					const needsSpace = pos > 0 && doc.textBetween(pos - 1, pos) !== ' ';

					// Create the citation text
					const citationText = attrs.text || `[${attrs.id}]`;

					return chain()
						.focus()
						.insertContentAt(pos, [
							...(needsSpace ? [{ type: 'text', text: ' ' }] : []),
							{ type: 'text', text: citationText }
						])
						.setTextSelection(pos + (needsSpace ? 1 : 0) + citationText.length)
						.run();
				}
		} as Partial<RawCommands>;
	}
});
