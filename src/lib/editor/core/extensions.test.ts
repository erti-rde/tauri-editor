import { describe, expect, it, afterEach } from 'vitest';

import { Editor } from './Editor';
import { editorExtensions } from './extensions';

/**
 * Smoke tests for the real editor extension set.
 *
 * Constructing a TipTap editor exercises schema building, plugin registration
 * and command wiring — the things a major TipTap upgrade breaks. Typechecking
 * does not catch any of it, and the app opens on a landing screen so the editor
 * is not mounted until a project is opened, which makes manual checks easy to
 * skip. These run in jsdom instead.
 */

let editor: Editor | undefined;

function makeEditor(content?: string) {
	editor = new Editor({
		element: document.createElement('div'),
		extensions: editorExtensions,
		content
	});
	return editor;
}

afterEach(() => {
	editor?.destroy();
	editor = undefined;
});

describe('editor extension set', () => {
	it('builds a schema and mounts without throwing', () => {
		const e = makeEditor('<p>hello</p>');

		expect(e.isDestroyed).toBe(false);
		expect(e.getText()).toBe('hello');
	});

	it('registers every node and mark the toolbar drives', () => {
		const { schema } = makeEditor();

		// Nodes the toolbar and table popover insert.
		for (const node of [
			'doc',
			'paragraph',
			'heading',
			'image',
			'table',
			'tableRow',
			'tableCell',
			'tableHeader',
			'blockquote',
			'codeBlock',
			'citation'
		]) {
			expect(schema.nodes[node], `node: ${node}`).toBeDefined();
		}

		// Marks, including link and underline which TipTap 3 folds into StarterKit.
		for (const mark of [
			'bold',
			'italic',
			'strike',
			'code',
			'link',
			'underline',
			'highlight',
			'subscript',
			'superscript'
		]) {
			expect(schema.marks[mark], `mark: ${mark}`).toBeDefined();
		}
	});

	it('applies marks through the command chain', () => {
		const e = makeEditor('<p>sample text</p>');

		e.commands.selectAll();
		e.commands.toggleBold();
		expect(e.isActive('bold')).toBe(true);

		e.commands.toggleUnderline();
		expect(e.isActive('underline')).toBe(true);

		e.commands.toggleHighlight();
		expect(e.isActive('highlight')).toBe(true);
	});

	it('keeps the link configuration from StarterKit', () => {
		const e = makeEditor('<p>sample text</p>');

		e.commands.selectAll();
		e.commands.setLink({ href: 'https://example.org' });

		expect(e.isActive('link')).toBe(true);
		// Configured via StarterKit.configure({ link: { HTMLAttributes } }).
		expect(e.getHTML()).toContain('tiptap-link');
	});

	it('inserts a table with the consolidated table extensions', () => {
		const e = makeEditor('<p></p>');

		e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });

		const html = e.getHTML();
		expect(html).toContain('<table');
		expect(html).toContain('<th');
		expect(html).toContain('<td');
	});

	it('exposes the custom citation commands', () => {
		const e = makeEditor('<p></p>');

		expect(typeof e.commands.insertCitation).toBe('function');
		expect(typeof e.commands.updateAllCitation).toBe('function');
	});

	it('inserts a citation node carrying its id and label', () => {
		const e = makeEditor('<p></p>');

		e.commands.insertCitation({ id: '["smith-2020-a"]', label: '(Smith, 2020a)' });

		const html = e.getHTML();
		expect(html).toContain('data-type="citation"');
		expect(html).toContain('(Smith, 2020a)');
	});

	it('round-trips a document through JSON, as autosave does', () => {
		const e = makeEditor('<h1>Title</h1><p>Body text</p>');
		const json = e.getJSON();

		e.destroy();

		editor = new Editor({
			element: document.createElement('div'),
			extensions: editorExtensions,
			content: json
		});

		expect(editor.getText()).toContain('Title');
		expect(editor.getText()).toContain('Body text');
	});
});
