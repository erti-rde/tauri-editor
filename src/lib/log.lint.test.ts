// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// M1a-12 AC-2: `$lib/log` is the only logger, and the linter keeps it so.
// That none is left is `pnpm lint`'s to say, over every file.
describe('the one logger', () => {
	const eslint = new ESLint();
	const problems = async (code: string, filePath: string) =>
		(await eslint.lintText(code, { filePath }))[0].messages.map((m) => m.ruleId);

	it('is the only place console may be used', async () => {
		expect(await problems('console.error("x");\n', 'src/lib/somewhere.ts')).toContain('no-console');
		expect(await problems('console.log("x");\n', 'src/routes/+page.ts')).toContain('no-console');
	});

	it('owns the log plugin', async () => {
		const importing = "import { error } from '@tauri-apps/plugin-log';\nvoid error;\n";
		expect(await problems(importing, 'src/lib/somewhere.ts')).toContain('no-restricted-imports');
		expect(await problems(importing, 'src/lib/log.ts')).not.toContain('no-restricted-imports');
	});
});
