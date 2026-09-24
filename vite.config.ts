import { sveltekit } from '@sveltejs/kit/vite';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		tailwindcss(),
		Icons({
			compiler: 'svelte',
			defaultClass: 'icon'
		})
	],
	optimizeDeps: {
		include: ['pdfjs-dist']
	},
	server: {
		fs: {
			// The browser harness (M1a-1) reads the bundled styles as the app reads
			// them from its Resource directory, and opens a fixture paper.
			allow: ['src-tauri/resources/csl', 'tests/fixtures/harness']
		}
	}
});
