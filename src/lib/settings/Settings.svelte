<script lang="ts">
	import { onMount } from 'svelte';

	import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
	import { load as loadStore } from '@tauri-apps/plugin-store';
	import type { Store } from '@tauri-apps/plugin-store';

	// Store for settings
	let store: Store;
	let wordCount = 0;
	let selectedStyle = '';
	let selectedLocale = '';
	let citationStyles: { name: string; download_url: string }[] = [];
	let locales: { [key: string]: string[] } = {};

	// Load citation styles and locales from resources folder
	async function loadResources() {
		try {
			const { styles, localesData } = await readResourceFiles();
			citationStyles = styles;
			locales = localesData['language-names'];
		} catch (error) {
			console.error('Error loading resources:', error);
		}
	}

	async function readResourceFiles() {
		const cslStyleResources = await readTextFile('resources/csl/cslStyles.json', {
			baseDir: BaseDirectory.Resource
		});
		const cslLocalesResources = await readTextFile('resources/csl/cslLocales.json', {
			baseDir: BaseDirectory.Resource
		});

		return {
			styles: JSON.parse(cslStyleResources),
			localesData: JSON.parse(cslLocalesResources)
		};
	}

	// Save settings
	async function saveSettings() {
		// Save citation style
		let oldStyle = (await store.get('selectedStyle')) as string;
		let cslXml = await store.get('cslXml');

		if (oldStyle !== selectedStyle || !cslXml) {
			await store.set('selectedStyle', selectedStyle);
			const style = citationStyles.find((style) => style.name === selectedStyle);
			const styleXml = await fetch(style.download_url).then((res) => res.text());
			await store.set('cslXml', styleXml);
		}

		// Save locale
		let oldLocale = (await store.get('selectedLocale')) as string;
		let localeXml = await store.get('localeXml');

		if (oldLocale !== selectedLocale || !localeXml) {
			await store.set('selectedLocale', selectedLocale);
			// Construct the URL for the locale XML file
			const localeUrl = `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${selectedLocale}.xml`;
			const localeXml = await fetch(localeUrl).then((res) => res.text());
			await store.set('localeXml', localeXml);
		}

		await store.set('wordCount', wordCount);
	}

	onMount(async () => {
		store = await loadStore('settings-store.json');
		wordCount = (await store.get('wordCount')) as number;
		selectedStyle = (await store.get('selectedStyle')) as string;
		selectedLocale = ((await store.get('selectedLocale')) as string) || 'en-GB';
		await loadResources();
	});
</script>

<div class="settings-container p-4">
	<h2 class="mb-6 text-xl font-bold">Settings</h2>

	<div class="setting-section mb-6">
		<h3 class="mb-2 text-lg font-semibold">Word Count</h3>
		<input type="number" bind:value={wordCount} min="0" class="w-full rounded border p-2" />
	</div>

	<div class="setting-section mb-6">
		<h3 class="mb-2 text-lg font-semibold">Citation Style</h3>
		<select bind:value={selectedStyle} class="w-full rounded border p-2">
			<option value="">Select a style</option>
			{#each citationStyles as style}
				<option value={style.name}>{style.name}</option>
			{/each}
		</select>
	</div>

	<!-- choose language locale -->
	<div class="setting-section mb-6">
		<h3 class="mb-2 text-lg font-semibold">Language</h3>
		<select bind:value={selectedLocale} class="w-full rounded border p-2">
			{#each Object.entries(locales) as [code, [native]]}
				<option value={code}>{native}</option>
			{/each}
		</select>
	</div>

	<button
		on:click={saveSettings}
		class="rounded bg-orange-500 px-4 py-2 text-white hover:bg-orange-600"
	>
		Save Settings
	</button>
</div>

<style>
	input,
	select {
		background-color: var(--bg-color);
		border-color: var(--border-color);
	}

	input:focus,
	select:focus {
		outline: none;
		border-color: var(--focus-color);
	}
</style>
