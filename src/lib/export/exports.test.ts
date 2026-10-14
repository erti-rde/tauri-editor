import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';

const tauri = vi.hoisted(() => ({
	save: vi.fn(),
	writeFile: vi.fn(),
	writeTextFile: vi.fn(),
	mkdir: vi.fn(),
	reveal: vi.fn(),
	detect: vi.fn(),
	compile: vi.fn(),
	toast: vi.fn(),
	errorToast: vi.fn(),
	toDocx: vi.fn()
}));

vi.mock('@tauri-apps/api/path', () => ({ join: async (...parts: string[]) => parts.join('/') }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: tauri.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({
	writeFile: tauri.writeFile,
	writeTextFile: tauri.writeTextFile,
	mkdir: tauri.mkdir
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: tauri.reveal }));
vi.mock('$lib/ipc', () => ({
	commands: { detectTexToolchain: tauri.detect, compileLatex: tauri.compile },
	call: (pending: unknown) => pending
}));
vi.mock('$lib/ui/Toast.svelte', () => ({ toast: tauri.toast, errorToast: tauri.errorToast }));
vi.mock('$lib/stores/citationStore', () => ({
	citationStore: {
		renderDocument: () => ({ notes: [{ index: 1, text: 'Smith, <i>Coasts</i>.' }] }),
		getAllSourcesAsJson: () => ({}),
		canonicalId: (id: string) => id
	}
}));
vi.mock('./docx', () => ({ toDocx: tauri.toDocx }));

import { createExports } from './exports';

function exportsFor(doc: JSONContent, title: string | null = 'Chapter 2') {
	const updateAllCitation = vi.fn();
	const editor = {
		getJSON: () => doc,
		state: { doc: { descendants: () => {} } },
		commands: { updateAllCitation }
	} as unknown as Editor;
	const flush = vi.fn(async () => true);
	const exports = createExports({
		editor: () => editor,
		flush,
		title: () => title,
		directory: () => '/projects/thesis'
	});
	return { exports, flush, updateAllCitation };
}

const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
const lastToast = () => tauri.toast.mock.lastCall?.[0];

beforeEach(() => {
	vi.clearAllMocks();
	tauri.toDocx.mockResolvedValue(new Uint8Array([0x50, 0x4b]));
	tauri.reveal.mockResolvedValue(undefined);
});

describe('M5-6 Word…', () => {
	it('asks where to save, beside the project, as a Word document', async () => {
		const { exports } = exportsFor(doc);
		tauri.save.mockResolvedValue('/Users/ana/Desktop/Chapter 2.docx');

		await exports.word();

		expect(tauri.save).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultPath: '/projects/thesis/Chapter 2.docx',
				filters: [{ name: 'Word document', extensions: ['docx'] }]
			})
		);
		expect(tauri.writeFile).toHaveBeenCalledWith(
			'/Users/ana/Desktop/Chapter 2.docx',
			new Uint8Array([0x50, 0x4b])
		);
	});

	it('writes the document as saved, its citations rendered, with their notes', async () => {
		const { exports, flush, updateAllCitation } = exportsFor(doc);
		tauri.save.mockResolvedValue('/out/Chapter 2.docx');

		await exports.word();

		expect(flush).toHaveBeenCalled();
		expect(updateAllCitation).toHaveBeenCalled();
		expect(tauri.toDocx).toHaveBeenCalledWith(
			doc,
			expect.objectContaining({
				title: 'Chapter 2',
				notes: [{ index: 1, text: 'Smith, <i>Coasts</i>.' }],
				page: expect.objectContaining({ width: 12240, margin: 1440 })
			})
		);
	});

	it('M5-6 AC-2: ends with a toast that shows the file in its folder', async () => {
		const { exports } = exportsFor(doc);
		tauri.save.mockResolvedValue('/out/Chapter 2.docx');

		await exports.word();

		expect(lastToast()).toMatchObject({
			kind: 'success',
			title: 'Exported Chapter 2.docx',
			action: { label: 'Show in folder' }
		});
		lastToast().action.run();
		expect(tauri.reveal).toHaveBeenCalledWith('/out/Chapter 2.docx');
	});

	it('writes nothing when the save is cancelled', async () => {
		const { exports } = exportsFor(doc);
		tauri.save.mockResolvedValue(null);

		await exports.word();

		expect(tauri.writeFile).not.toHaveBeenCalled();
		expect(tauri.toast).not.toHaveBeenCalled();
	});

	it('says which images it couldn’t read, rather than leaving them out quietly', async () => {
		// jsdom decodes no images, so this one can't be read.
		const { exports } = exportsFor({
			type: 'doc',
			content: [{ type: 'image', attrs: { src: 'asset://localhost/figure.png' } }]
		});
		tauri.save.mockResolvedValue('/out/Chapter 2.docx');

		await exports.word();

		expect(lastToast().description).toBe(
			'1 image couldn’t be read, and is named in brackets where it goes.'
		);
	});

	it('says why when it fails', async () => {
		const { exports } = exportsFor(doc);
		tauri.save.mockResolvedValue('/out/Chapter 2.docx');
		tauri.writeFile.mockRejectedValue(new Error('The disk is full.'));

		await exports.word();

		expect(tauri.errorToast).toHaveBeenCalledWith(
			'Couldn’t export the Word document',
			'The disk is full.'
		);
	});

	it('does nothing with no document open', async () => {
		const { exports } = exportsFor(doc, null);

		await exports.word();

		expect(tauri.save).not.toHaveBeenCalled();
	});
});

describe('M5-6 LaTeX bundle…', () => {
	it('M5-6 AC-2: writes the bundle and offers to show it, when there’s no TeX to compile it', async () => {
		const { exports } = exportsFor(doc);
		tauri.detect.mockResolvedValue({ engine: null, bibliography: null });

		await exports.latex();

		expect(tauri.writeTextFile).toHaveBeenCalledWith(
			'/projects/thesis/export/main.tex',
			expect.stringContaining('\\begin{document}')
		);
		expect(lastToast()).toMatchObject({
			kind: 'success',
			title: 'Wrote main.tex and references.bib',
			action: { label: 'Show in folder' }
		});
		lastToast().action.run();
		expect(tauri.reveal).toHaveBeenCalledWith('/projects/thesis/export/main.tex');
	});

	it('M5-6 AC-2: shows the PDF it compiled', async () => {
		const { exports } = exportsFor(doc);
		tauri.detect.mockResolvedValue({ engine: 'tectonic', bibliography: null });
		tauri.compile.mockResolvedValue({
			ok: true,
			pdf: '/projects/thesis/export/main.pdf',
			log: ''
		});

		await exports.latex();

		expect(lastToast()).toMatchObject({ title: 'Compiled main.pdf' });
		lastToast().action.run();
		expect(tauri.reveal).toHaveBeenCalledWith('/projects/thesis/export/main.pdf');
	});

	it('M5-6 AC-2: shows what TeX said when it couldn’t compile', async () => {
		const { exports } = exportsFor(doc);
		tauri.detect.mockResolvedValue({ engine: 'pdflatex', bibliography: null });
		tauri.compile.mockResolvedValue({ ok: false, pdf: null, log: '! Undefined control sequence.' });

		await exports.latex();

		expect(tauri.writeTextFile).toHaveBeenCalledWith(
			'/projects/thesis/export/compile.log',
			'! Undefined control sequence.'
		);
		expect(lastToast()).toMatchObject({
			kind: 'danger',
			title: 'pdflatex couldn’t compile main.tex'
		});
		lastToast().action.run();
		expect(tauri.reveal).toHaveBeenCalledWith('/projects/thesis/export/compile.log');
	});
});

describe('PDF…', () => {
	it('prints the document as saved, its citations current', async () => {
		const { exports, flush, updateAllCitation } = exportsFor(doc);
		const print = vi.spyOn(window, 'print').mockImplementation(() => {});

		await exports.pdf();

		expect(flush).toHaveBeenCalled();
		expect(updateAllCitation).toHaveBeenCalled();
		expect(print).toHaveBeenCalled();
	});
});
