// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// That nothing else calls `getDocument` is `pnpm lint`'s to say, over every
// file; this pins the rule that makes it so.
describe('the one way to open a PDF', () => {
	const eslint = new ESLint();
	const problems = async (code: string, filePath: string) =>
		(await eslint.lintText(code, { filePath }))[0].messages.map((m) => m.ruleId);

	it('M6-3 AC-1: is the only place pdf.js itself may be imported', async () => {
		const importing = "import * as pdfjs from 'pdfjs-dist';\nvoid pdfjs;\n";
		for (const file of [
			'src/lib/pdfreader/viewer.ts',
			'src/utils/pdf_handlers.ts',
			'src/lib/ipc/x.ts'
		]) {
			expect(await problems(importing, file)).toContain('no-restricted-imports');
		}
		for (const build of [
			'pdfjs-dist/build/pdf.mjs',
			'pdfjs-dist/build/pdf.min.mjs',
			'pdfjs-dist/build/pdf',
			'pdfjs-dist/legacy/build/pdf.mjs',
			'pdfjs-dist/legacy/build/pdf.min.mjs'
		]) {
			const code = `import * as pdfjs from '${build}';\nvoid pdfjs;\n`;
			expect(await problems(code, 'src/lib/somewhere.ts'), build).toContain(
				'no-restricted-imports'
			);
		}
		expect(await problems(importing, 'src/lib/pdfjs.ts')).not.toContain('no-restricted-imports');
	});

	it('M6-3 AC-1: refuses pdf.js imported at run time, too', async () => {
		for (const call of [
			"import('pdfjs-dist')",
			"import('pdfjs-dist/legacy/build/pdf.min.mjs')",
			'import(`pdfjs-dist`)',
			'import(`pdfjs-dist/build/pdf.mjs`)',
			'import(`pdfjs-dist/build/${name}`)'
		]) {
			const code = `const name = 'pdf.mjs';\nexport const pdfjs = () => ${call};\n`;
			expect(await problems(code, 'src/lib/somewhere.ts'), call).toContain('no-restricted-syntax');
		}
		expect(
			await problems("export const pdfjs = () => import('pdfjs-dist');\n", 'src/lib/pdfjs.ts')
		).not.toContain('no-restricted-syntax');
	});

	it('M6-3 AC-1: leaves the viewer and the types open, which open nothing', async () => {
		const code = [
			"import { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';",
			"import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';",
			'export type Both = [PDFViewer, PDFDocumentProxy];',
			"export const viewer = () => import('pdfjs-dist/web/pdf_viewer.mjs');",
			'export const css = () => import(`pdfjs-dist/web/pdf_viewer.css`);',
			''
		].join('\n');
		const found = await problems(code, 'src/lib/pdfreader/viewer.ts');
		expect(found).not.toContain('no-restricted-imports');
		expect(found).not.toContain('no-restricted-syntax');
	});
});
