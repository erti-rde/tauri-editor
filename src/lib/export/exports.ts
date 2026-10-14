import type { Editor, JSONContent } from '@tiptap/core';
import { join } from '@tauri-apps/api/path';
import { save } from '@tauri-apps/plugin-dialog';
import { mkdir, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { get } from 'svelte/store';

import { parseCitationIds } from '$lib/citations/document';
import { citationSites } from '$lib/editor/extensions/citation/Citation';
import { pageSetupStore } from '$lib/editor/pagination/pageSetupStore';
import { toDocxPageSetup, toLatexPageSetup } from '$lib/editor/pagination/paper';
import { call, commands } from '$lib/ipc';
import { log } from '$lib/log';
import { citationStore } from '$lib/stores/citationStore';
import { errorToast, toast } from '$lib/ui/Toast.svelte';

import { toBibliography } from './bibtex';
import type { DocxImage } from './docx';
import { toLatexDocument } from './latex';

/**
 * The Export menu's actions (M5-6, docs/ux.md UX-8): PDF, Word and LaTeX, each
 * from the document as it is on screen, each ending in a toast that says what
 * was written and offers to show it.
 */

export interface ExportContext {
	editor: () => Editor;
	/** Writes anything still waiting, so the export and the file are one document. */
	flush: () => Promise<unknown>;
	/** The open document's title, which names what's written. Null when none is open. */
	title: () => string | null;
	/** The project folder. */
	directory: () => string;
}

export interface Exports {
	pdf: () => Promise<void>;
	word: () => Promise<void>;
	latex: () => Promise<void>;
}

const showInFolder = (path: string) => ({
	label: 'Show in folder',
	run: () =>
		void revealItemInDir(path).catch((error) => log.error('Could not show the file', error))
});

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createExports(context: ExportContext): Exports {
	/**
	 * Everything an export reads is current: the file saved, and the citations
	 * and works cited rendered from the document as it now is.
	 */
	async function settle() {
		await context.flush();
		context.editor().commands.updateAllCitation();
	}

	return {
		/**
		 * Through the webview's print, whose sheet is where "Save as PDF" lives:
		 * what's on screen is what comes out. The sheet doesn't say where it saved,
		 * so there's no folder to show (M5-4 decides where a direct save is needed).
		 */
		async pdf() {
			await settle();
			window.print();
		},

		/** Asks where, then writes the same document as a .docx (M5-5). */
		async word() {
			const title = context.title();
			if (title === null) return;
			await settle();

			const path = await save({
				title: 'Export as a Word document',
				defaultPath: await join(context.directory(), `${title}.docx`),
				filters: [{ name: 'Word document', extensions: ['docx'] }]
			});
			if (!path) return;

			try {
				const editor = context.editor();
				const doc = editor.getJSON();
				const rendered = citationStore.renderDocument(citationSites(editor.state.doc));
				// Loaded here, not with the editor: most people never export to Word.
				const [{ toDocx }, images] = await Promise.all([import('./docx'), imagesOf(doc)]);

				await writeFile(
					path,
					await toDocx(doc, {
						title,
						page: toDocxPageSetup(get(pageSetupStore)),
						notes: rendered?.notes,
						images: images.read
					})
				);

				toast({
					kind: 'success',
					title: `Exported ${fileNameOf(path)}`,
					description:
						images.missed > 0
							? `${images.missed === 1 ? '1 image' : `${images.missed} images`} couldn’t be read, and ${images.missed === 1 ? 'is' : 'are'} named in brackets where ${images.missed === 1 ? 'it goes' : 'they go'}.`
							: undefined,
					action: showInFolder(path)
				});
			} catch (error) {
				log.error('Word export failed', error);
				errorToast('Couldn’t export the Word document', messageOf(error));
			}
		},

		/**
		 * A LaTeX bundle in the project's `export/`, compiled if this machine can.
		 *
		 * Into the project rather than wherever the writer picks: TeX runs in the
		 * folder it's given and reads what `main.tex` tells it to, so compiling is
		 * held to folders the writer has given Erti (M1a-3). Erti doesn't ship TeX
		 * Live, so the bundle is the deliverable and compiling is an offer.
		 */
		async latex() {
			const title = context.title();
			if (title === null) return;
			await settle();

			try {
				const editor = context.editor();
				const doc = editor.getJSON();

				// Only the works this manuscript cites: a .bib of the whole library
				// lists papers it never mentions, and some journals check.
				const cited: string[] = [];
				editor.state.doc.descendants((node) => {
					if (node.type.name === 'citation') cited.push(...parseCitationIds(node.attrs.id));
					return true;
				});
				const { bibtex, keys } = toBibliography(
					citationStore.getAllSourcesAsJson(),
					cited,
					citationStore.canonicalId
				);

				const dir = await join(context.directory(), 'export');
				await mkdir(dir, { recursive: true });
				const tex = await join(dir, 'main.tex');
				await writeTextFile(
					tex,
					toLatexDocument(doc, {
						title,
						citationKeys: keys,
						// The same paper, margins and spacing the PDF gets.
						page: toLatexPageSetup(get(pageSetupStore))
					})
				);
				await writeTextFile(await join(dir, 'references.bib'), bibtex);

				const { engine } = await commands.detectTexToolchain();
				if (!engine) {
					// Said rather than hidden: the bundle is the useful artefact, and
					// Overleaf is where most co-authors will open it.
					toast({
						kind: 'success',
						title: 'Wrote main.tex and references.bib',
						description:
							'No LaTeX installation was found, so it wasn’t compiled. The export folder is ready for Overleaf or a journal.',
						action: showInFolder(tex)
					});
					return;
				}

				const result = await call(commands.compileLatex(dir, engine));
				if (result.ok) {
					toast({
						kind: 'success',
						title: 'Compiled main.pdf',
						description: `With ${engine}, in the export folder.`,
						action: showInFolder(result.pdf ?? tex)
					});
					return;
				}

				// What the engine said is the only account of what went wrong. It's
				// written beside the bundle, the user's own folder, and never into
				// Erti's log: TeX quotes the manuscript line by line. Not main.log,
				// which tectonic doesn't write unless asked.
				log.warn(`${engine} could not compile the LaTeX bundle`);
				const compileLog = await join(dir, 'compile.log');
				await writeTextFile(compileLog, result.log);
				toast({
					kind: 'danger',
					title: `${engine} couldn’t compile main.tex`,
					description: 'What it said is in compile.log, beside the bundle.',
					action: showInFolder(compileLog)
				});
			} catch (error) {
				log.error('LaTeX export failed', error);
				errorToast('Couldn’t write the LaTeX bundle', messageOf(error));
			}
		}
	};
}

function fileNameOf(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

/**
 * The images' bytes, read the way the editor shows them: through the asset
 * protocol, which answers the window's own origin, so a canvas can read them
 * back. Re-encoded as PNG, which Word and LibreOffice both take.
 */
async function imagesOf(doc: JSONContent) {
	const sources = new Set<string>();
	const visit = (node: JSONContent) => {
		if (node.type === 'image' && typeof node.attrs?.src === 'string') sources.add(node.attrs.src);
		node.content?.forEach(visit);
	};
	visit(doc);

	const read: Record<string, DocxImage> = {};
	let missed = 0;
	await Promise.all(
		[...sources].map(async (src) => {
			const image = await readImage(src);
			if (image) read[src] = image;
			else missed++;
		})
	);
	return { read, missed };
}

async function readImage(src: string): Promise<DocxImage | null> {
	try {
		const image = new Image();
		image.crossOrigin = 'anonymous';
		image.src = src;
		await image.decode();

		const canvas = document.createElement('canvas');
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		canvas.getContext('2d')?.drawImage(image, 0, 0);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (!blob) return null;

		return {
			data: new Uint8Array(await blob.arrayBuffer()),
			type: 'png',
			width: image.naturalWidth,
			height: image.naturalHeight
		};
	} catch (error) {
		// Not the path: it's the writer's file system, and the toast says enough.
		log.warn('Could not read an image for the Word export', error);
		return null;
	}
}
