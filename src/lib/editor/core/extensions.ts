import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
// TipTap 3 consolidated the four table packages into one with named exports.
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import StarterKit from '@tiptap/starter-kit';

import { Citation } from '../extensions/citation/Citation';

/**
 * The editor's extension set.
 *
 * Lives here rather than inline in Editor.svelte so tests can construct a real
 * editor from the same list the app uses — a copy would drift and stop catching
 * upgrade breakage, which is the main thing this guards.
 */
export const editorExtensions = [
	// TipTap 3's StarterKit bundles Link and Underline, so they are configured
	// here rather than registered as separate extensions.
	StarterKit.configure({
		link: {
			HTMLAttributes: {
				class: 'tiptap-link'
			},
			openOnClick: false,
			defaultProtocol: 'https'
		}
	}),
	TextAlign.configure({
		types: ['heading', 'paragraph']
	}),
	Subscript,
	Superscript,
	Highlight,
	Image,
	Table.configure({
		resizable: true
	}),
	TableRow,
	TableHeader,
	TableCell,
	Citation
];
