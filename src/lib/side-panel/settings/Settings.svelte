<script lang="ts">
	import { onMount } from 'svelte';
	import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
	import { load as loadStore } from '@tauri-apps/plugin-store';
	import type { Store } from '@tauri-apps/plugin-store';
	import { Icon } from '$lib';
	import { clickOutside } from '$utils/clickOutside.svelte';
	import { getConsent, getMailto, setConsent, setMailto } from '$lib/stores/consent';

	interface Props {
		isOpen: boolean;
		closeSettings: () => void;
	}

	const { isOpen = false, closeSettings }: Props = $props();

	let store: Store;

	let wordCount = $state(0);
	let selectedStyle = $state('');
	let selectedLocale = $state('');
	let citationStyles: { name: string; download_url: string }[] = $state([]);
	let locales: { [key: string]: string[] } = $state({});
	let activeTab = $state('general');

	// Governs every outbound request: metadata lookups and citation-style
	// downloads alike.
	let allowNetwork = $state(false);
	let crossrefMailto = $state('');

	// Load citation styles and locales from resources folder
	async function loadResources() {
		try {
			const { styles, localesData } = await readResourceFiles();
			// Both resource files are read from disk and may be missing or malformed,
			// so guard the entries and not just the containers: a bad file can yield
			// [null] or { en: null }, which would throw in the template rather than
			// here. Falling back to empty collections keeps the dialog renderable.
			citationStyles = Array.isArray(styles)
				? styles.filter(
						(style) => typeof style?.name === 'string' && typeof style?.download_url === 'string'
					)
				: [];

			const languageNames = localesData?.['language-names'];
			locales =
				languageNames && typeof languageNames === 'object' && !Array.isArray(languageNames)
					? (Object.fromEntries(
							Object.entries(languageNames).filter(
								(entry): entry is [string, string[]] =>
									Array.isArray(entry[1]) && typeof entry[1][0] === 'string'
							)
						) as { [key: string]: string[] })
					: {};
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
		try {
			let styleHasChanged = false;
			let localeHasChanged = false;
			let wordCountHasChanged = false;
			// Save citation style
			let oldStyle = (await store.get('selectedStyle')) as string;
			let oldStyleXml = (await store.get('cslXml')) as string;
			let oldWordCount = (await store.get('wordCount')) as number;

			if (oldStyle !== selectedStyle || !oldStyleXml) {
				await store.set('selectedStyle', selectedStyle);
				const style = citationStyles.find((style) => style.name === selectedStyle);
				if (style) {
					try {
						const response = await fetch(style.download_url);
						if (!response.ok) {
							throw new Error(`Failed to fetch style: ${response.status}`);
						}
						const styleXml = await response.text();

						// Verify that we received valid XML
						if (!styleXml || !styleXml.trim().startsWith('<')) {
							console.error('Invalid style XML received:', styleXml?.substring(0, 100));
							throw new Error('Invalid style XML');
						}

						await store.set('cslXml', styleXml);
						styleHasChanged = true;
					} catch (error) {
						console.error('Error fetching style:', error);
						// If fetch fails, keep the old style selected
						await store.set('selectedStyle', oldStyle);
						throw error;
					}
				}
			}

			// Save locale
			let oldLocale = (await store.get('selectedLocale')) as string;
			let oldLocaleXml = (await store.get('localeXml')) as string;

			if (oldLocale !== selectedLocale || !oldLocaleXml) {
				await store.set('selectedLocale', selectedLocale);
				// Construct the URL for the locale XML file
				const localeUrl = `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${selectedLocale}.xml`;

				try {
					const response = await fetch(localeUrl);
					if (!response.ok) {
						throw new Error(`Failed to fetch locale: ${response.status}`);
					}
					const localeXml = await response.text();

					// Verify that we received valid XML
					if (!localeXml || !localeXml.trim().startsWith('<')) {
						console.error('Invalid locale XML received:', localeXml?.substring(0, 100));
						throw new Error('Invalid locale XML');
					}

					await store.set('localeXml', localeXml);
					localeHasChanged = true;
				} catch (error) {
					console.error('Error fetching locale:', error);
					// If fetch fails, keep the old locale selected
					await store.set('selectedLocale', oldLocale);
					throw error;
				}
			}

			if (oldWordCount !== wordCount) {
				await store.set('wordCount', wordCount);
				wordCountHasChanged = true;
			}

			await setConsent(allowNetwork);
			await setMailto(crossrefMailto);

			window.dispatchEvent(
				new CustomEvent('settings-updated', {
					detail: { localeHasChanged, styleHasChanged, wordCountHasChanged }
				})
			);

			closeSettings();
		} catch (error) {
			console.error('Error saving settings:', error);
		}
	}

	function setActiveTab(tab: string) {
		activeTab = tab;
	}

	onMount(async () => {
		store = await loadStore('settings-store.json');
		wordCount = ((await store.get('wordCount')) as number) || 0;
		selectedStyle = ((await store.get('selectedStyle')) as string) || '';
		selectedLocale = ((await store.get('selectedLocale')) as string) || 'en-GB';
		allowNetwork = (await getConsent()) === 'granted';
		crossrefMailto = (await getMailto()) ?? '';
		await loadResources();
	});
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-100 flex items-center justify-center bg-black/50"
		style="z-index: 100;"
	>
		<dialog
			open
			class="relative z-10 flex h-[550px] max-h-[90vh] w-[800px] max-w-[90%] flex-col overflow-hidden rounded-lg bg-white shadow-xl"
			aria-labelledby="settings-title"
			use:clickOutside
			onoutclick={closeSettings}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-gray-200 px-5 py-4">
				<h2 id="settings-title" class="text-xl font-semibold text-gray-800">Settings</h2>
				<button
					class="rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
					onclick={closeSettings}
				>
					<Icon icon="X" />
				</button>
			</div>

			<!-- Content -->
			<div class="flex flex-1 overflow-hidden">
				<!-- Sidebar -->
				<div class="w-48 border-r border-gray-200 bg-gray-50">
					{#each [{ id: 'general', label: 'General' }, { id: 'citations', label: 'Citations' }, { id: 'appearance', label: 'Appearance' }] as tab (tab.id)}
						<button
							class="w-full border-l-2 px-4 py-3 text-left transition-colors hover:bg-gray-100 {activeTab ===
							tab.id
								? 'border-orange-500 bg-gray-100 font-medium'
								: 'border-transparent'}"
							onclick={() => setActiveTab(tab.id)}
						>
							{tab.label}
						</button>
					{/each}
				</div>

				<!-- Settings panels -->
				<div class="relative flex-1 bg-white">
					<!-- General Settings -->
					<div
						class="absolute inset-0 overflow-y-auto {activeTab === 'general'
							? 'block'
							: 'hidden'} p-5"
					>
						<div class="mb-8">
							<h3 class="mb-4 border-b border-gray-200 pb-2 text-lg font-medium text-gray-900">
								General Settings
							</h3>

							<div class="mb-6">
								<label for="word-count" class="mb-2 block font-medium text-gray-700">
									Word Count Target
								</label>
								<div class="relative">
									<input
										id="word-count"
										type="number"
										bind:value={wordCount}
										min="0"
										class="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-800 transition-colors focus:border-orange-500 focus:ring-2 focus:ring-orange-500"
									/>
								</div>
								<p class="mt-1 text-sm text-gray-500">Set your target word count for documents</p>
							</div>

							<div class="mb-6">
								<label class="flex items-start gap-3">
									<input
										type="checkbox"
										bind:checked={allowNetwork}
										class="mt-1 h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
									/>
									<span>
										<span class="block font-medium text-gray-700"
											>Look up citation details online</span
										>
										<span class="mt-1 block text-sm text-gray-500">
											Sends a paper's identifier — or its title and the opening of its first page —
											to doi.org and crossref.org, and allows citation styles to be downloaded. With
											this off, Erti reads the identifier printed in each paper and nothing leaves
											your machine.
										</span>
									</span>
								</label>
							</div>

							{#if allowNetwork}
								<div class="mb-6">
									<label for="crossref-mailto" class="mb-2 block font-medium text-gray-700">
										Contact address for Crossref (optional)
									</label>
									<input
										id="crossref-mailto"
										type="email"
										bind:value={crossrefMailto}
										placeholder="you@university.edu"
										class="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-800 transition-colors focus:border-orange-500 focus:ring-2 focus:ring-orange-500"
									/>
									<p class="mt-1 text-sm text-gray-500">
										Crossref asks API users to identify themselves and gives those requests better
										service. Yours to provide or leave blank.
									</p>
								</div>
							{/if}
						</div>
					</div>

					<!-- Citation Settings -->
					<div
						class="absolute inset-0 overflow-y-auto {activeTab === 'citations'
							? 'block'
							: 'hidden'} p-5"
					>
						<div class="mb-8">
							<h3 class="mb-4 border-b border-gray-200 pb-2 text-lg font-medium text-gray-900">
								Citation Settings
							</h3>

							<div class="mb-6">
								<label for="citation-style" class="mb-2 block font-medium text-gray-700">
									Citation Style
								</label>
								<div class="relative">
									<select
										id="citation-style"
										bind:value={selectedStyle}
										class="w-full appearance-none rounded-md border border-gray-300 bg-white px-4 py-2 pr-8 text-gray-800 transition-colors focus:border-orange-500 focus:ring-2 focus:ring-orange-500"
									>
										<option value="" disabled>Select a style</option>
										{#each citationStyles as style (style.name)}
											<option value={style.name}>{style.name}</option>
										{/each}
									</select>
									<div
										class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2"
									>
										<svg
											class="h-5 w-5 text-gray-400"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 9l-7 7-7-7"
											></path>
										</svg>
									</div>
								</div>
								<p class="mt-1 text-sm text-gray-500">
									Choose your preferred citation style for references
								</p>
							</div>
							<div class="mb-6">
								<label for="language" class="mb-2 block font-medium text-gray-700">
									Citation Language
								</label>
								<div class="relative">
									<select
										id="language"
										bind:value={selectedLocale}
										class="w-full appearance-none rounded-md border border-gray-300 bg-white px-4 py-2 pr-8 text-gray-800 transition-colors focus:border-orange-500 focus:ring-2 focus:ring-orange-500"
									>
										{#each Object.entries(locales) as [code, [native]] (code)}
											<option value={code}>{native}</option>
										{/each}
									</select>
									<div
										class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2"
									>
										<svg
											class="h-5 w-5 text-gray-400"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 9l-7 7-7-7"
											></path>
										</svg>
									</div>
								</div>
								<p class="mt-1 text-sm text-gray-500">Set the language for the citation</p>
							</div>
						</div>
					</div>

					<!-- Appearance Settings -->
					<div
						class="absolute inset-0 overflow-y-auto {activeTab === 'appearance'
							? 'block'
							: 'hidden'} p-5"
					>
						<div class="mb-8">
							<h3 class="mb-4 border-b border-gray-200 pb-2 text-lg font-medium text-gray-900">
								Appearance Settings
							</h3>

							<div class="rounded-md border border-gray-200 bg-gray-50 p-4">
								<p class="text-gray-600 italic">
									Appearance settings will be available in a future update.
								</p>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="flex justify-end space-x-3 border-t border-gray-200 bg-gray-50 px-5 py-4">
				<button
					class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-100"
					onclick={closeSettings}
				>
					Cancel
				</button>
				<button
					class="rounded-md border border-orange-500 bg-orange-500 px-4 py-2 text-white transition-colors hover:bg-orange-600"
					onclick={saveSettings}
				>
					Save changes
				</button>
			</div>
		</dialog>
	</div>
{/if}
