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
		const legacy = "import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';\nvoid pdfjs;\n";
		expect(await problems(legacy, 'src/lib/somewhere.ts')).toContain('no-restricted-imports');
		expect(await problems(importing, 'src/lib/pdfjs.ts')).not.toContain('no-restricted-imports');
	});
});
