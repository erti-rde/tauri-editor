import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import Icons from 'unplugin-icons/vite';
import path from 'path';

export default defineConfig({
	plugins: [
		sveltekit(),
		svelteTesting(),
		Icons({
			compiler: 'svelte',
			defaultClass: 'icon'
		})
	],
	test: {
		globals: true,
		environment: 'jsdom',
		include: ['src/**/*.{test,spec}.{js,ts,svelte}'],
		setupFiles: ['./vitest.setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: ['node_modules/**', 'src-tauri/**', 'static/**', '**/*.d.ts']
		}
	},
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib'),
			$utils: path.resolve('./src/utils'),
			$types: path.resolve('./src/types'),
			$ui: path.resolve('./src/lib/ui')
		}
	}
});
