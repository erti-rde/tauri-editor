import { defineConfig, devices } from '@playwright/test';

/**
 * Journeys through the real app on the fake backend (M1a-1, docs/testing.md).
 *
 * The server is a `--mode harness` production build rather than `vite dev`:
 * the dev server optimises dependencies on first sight and reloads the page
 * part-way through a journey, which reads as a flaky test.
 */
const PORT = 4173;

export default defineConfig({
	testDir: 'e2e',
	outputDir: 'e2e/.results',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: process.env.CI
		? [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]]
		: 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		viewport: { width: 1280, height: 800 },
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }
		}
	],
	webServer: {
		command: `pnpm harness:build && pnpm exec vite preview --mode harness --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}/harness`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
