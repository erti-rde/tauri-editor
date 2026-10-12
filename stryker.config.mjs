/**
 * Mutation testing of the attribution classifier (M4-4 AC-3, docs/testing.md).
 *
 * Its thresholds and rules decide what a writer is told about their own
 * sentences, so a change to any of them has to fail a test. The score must stay
 * at 85% or above: `pnpm mutate:attribution` fails below it.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
	testRunner: 'vitest',
	// Named, since pnpm keeps the runner where Stryker's own wildcard can't see it.
	plugins: ['@stryker-mutator/vitest-runner'],
	vitest: { configFile: 'vitest.config.ts', related: true },
	mutate: ['src/lib/attribution/classify.ts'],
	coverageAnalysis: 'perTest',
	thresholds: { high: 90, low: 85, break: 85 },
	reporters: ['clear-text', 'progress'],
	// The sandbox is a copy of the project. Rust's build output alone runs to
	// tens of gigabytes, so everything the classifier's tests don't read stays
	// out of it.
	ignorePatterns: [
		'src-tauri',
		'build',
		'e2e',
		'docs',
		'static/pdf-assets',
		'tests/fixtures/retrieval/papers',
		'tests/fixtures/retrieval/chunks.json',
		'.claude'
	],
	tempDirName: '.stryker-tmp',
	cleanTempDir: 'always'
};
