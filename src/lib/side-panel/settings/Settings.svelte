<script lang="ts">
	import { Dialog, Tabs } from 'bits-ui';

	import AppearanceSettings from './AppearanceSettings.svelte';
	import PageSetupSettings from './PageSetupSettings.svelte';
	import { autoReferences } from '$lib/editor/references/referencesStore';
	import { onMount } from 'svelte';
	import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
	import { load as loadStore } from '@tauri-apps/plugin-store';
	import type { Store } from '@tauri-apps/plugin-store';
	import { Icon } from '$lib';
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

	onMount(async () => {
		store = await loadStore('settings-store.json');
		wordCount = ((await store.get('wordCount')) as number) || 0;
		selectedStyle = ((await store.get('selectedStyle')) as string) || '';
		selectedLocale = ((await store.get('selectedLocale')) as string) || 'en-GB';
		allowNetwork = (await getConsent()) === 'granted';
		crossrefMailto = (await getMailto()) ?? '';
		// The editor initialises this too, but Settings opens from the landing
		// screen where there is no editor — without this the box would show the
		// default rather than the choice someone already made.
		await autoReferences.initialise();
		await loadResources();
	});
</script>

<!--
	The dialog and its tabs come from bits-ui rather than being hand-rolled.
	What that buys is not styling — it is the behaviour a modal has to have and
	this one did not: Escape closes it, focus is trapped inside and restored to
	whatever opened it, the page behind is inert and does not scroll, and screen
	readers are told it is a dialog rather than reading a div.
	The tabs likewise gain arrow-key navigation and the roles that make them tabs.
-->
<Dialog.Root bind:open={() => isOpen, (v) => !v && closeSettings()}>
	<Dialog.Portal>
		<Dialog.Overlay class="bg-backdrop fixed inset-0 z-100" />

		<Dialog.Content
			class="bg-surface-raised border-line fixed top-1/2 left-1/2 z-100 flex h-[550px] max-h-[90vh] w-[800px] max-w-[90%] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border shadow-xl"
		>
			<!-- Header -->
			<div class="border-line flex items-center justify-between border-b px-5 py-4">
				<Dialog.Title class="text-ink text-xl font-semibold">Settings</Dialog.Title>
				<Dialog.Close
					class="text-ink-muted hover:bg-surface-hover hover:text-ink rounded-full p-1 transition-colors"
					aria-label="Close settings"
				>
					<Icon icon="X" />
				</Dialog.Close>
			</div>

			<Tabs.Root bind:value={activeTab} orientation="vertical" class="flex flex-1 overflow-hidden">
				<Tabs.List class="border-line bg-surface-sunken w-48 shrink-0 border-r">
					{#each [{ id: 'general', label: 'General' }, { id: 'citations', label: 'Citations' }, { id: 'page', label: 'Page setup' }, { id: 'appearance', label: 'Appearance' }] as tab (tab.id)}
						<Tabs.Trigger
							value={tab.id}
							class="hover:bg-surface-hover data-[state=active]:border-accent data-[state=active]:bg-surface-raised w-full border-l-2 border-transparent px-4 py-3 text-left transition-colors data-[state=active]:font-medium"
						>
							{tab.label}
						</Tabs.Trigger>
					{/each}
				</Tabs.List>

				<!-- Settings panels -->
				<div class="bg-surface-raised relative flex-1">
					<!-- General Settings -->
					<Tabs.Content value="general" class="absolute inset-0 overflow-y-auto p-5">
						<div class="mb-8">
							<h3 class="border-line text-ink mb-4 border-b pb-2 text-lg font-medium">
								General Settings
							</h3>

							<div class="mb-6">
								<label for="word-count" class="text-ink mb-2 block font-medium">
									Word Count Target
								</label>
								<div class="relative">
									<input
										id="word-count"
										type="number"
										bind:value={wordCount}
										min="0"
										class="border-line-strong bg-surface-raised text-ink focus:border-accent focus:ring-accent w-full rounded-md border px-4 py-2 transition-colors focus:ring-2"
									/>
								</div>
								<p class="text-ink-muted mt-1 text-sm">Set your target word count for documents</p>
							</div>

							<div class="mb-6">
								<label class="flex items-start gap-3">
									<input
										type="checkbox"
										bind:checked={allowNetwork}
										class="accent-accent focus-visible:ring-accent mt-1 h-4 w-4"
									/>
									<span>
										<span class="text-ink block font-medium">Look up citation details online</span>
										<span class="text-ink-muted mt-1 block text-sm">
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
									<label for="crossref-mailto" class="text-ink mb-2 block font-medium">
										Contact address for Crossref (optional)
									</label>
									<input
										id="crossref-mailto"
										type="email"
										bind:value={crossrefMailto}
										placeholder="you@university.edu"
										class="border-line-strong bg-surface-raised text-ink focus:border-accent focus:ring-accent w-full rounded-md border px-4 py-2 transition-colors focus:ring-2"
									/>
									<p class="text-ink-muted mt-1 text-sm">
										Crossref asks API users to identify themselves and gives those requests better
										service. Yours to provide or leave blank.
									</p>
								</div>
							{/if}
						</div>
					</Tabs.Content>

					<!-- Citation Settings -->
					<Tabs.Content value="citations" class="absolute inset-0 overflow-y-auto p-5">
						<div class="mb-8">
							<h3 class="border-line text-ink mb-4 border-b pb-2 text-lg font-medium">
								Citation Settings
							</h3>

							<label class="mb-6 flex items-start gap-3">
								<input
									type="checkbox"
									class="accent-accent mt-1 h-4 w-4"
									checked={$autoReferences}
									onchange={(e) => void autoReferences.update(e.currentTarget.checked)}
								/>
								<span>
									<span class="text-ink block font-medium">Add a reference list automatically</span>
									<span class="text-ink-muted mt-1 block text-sm">
										The first citation in a document brings a works-cited list with it. Delete the
										list and it stays deleted — this only ever adds the first one.
									</span>
								</span>
							</label>

							<div class="mb-6">
								<label for="citation-style" class="text-ink mb-2 block font-medium">
									Citation Style
								</label>
								<div class="relative">
									<select
										id="citation-style"
										bind:value={selectedStyle}
										class="border-line-strong bg-surface-raised text-ink focus:border-accent focus:ring-accent w-full appearance-none rounded-md border px-4 py-2 pr-8 transition-colors focus:ring-2"
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
											class="text-ink-muted h-5 w-5"
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
								<p class="text-ink-muted mt-1 text-sm">
									Choose your preferred citation style for references
								</p>
							</div>
							<div class="mb-6">
								<label for="language" class="text-ink mb-2 block font-medium">
									Citation Language
								</label>
								<div class="relative">
									<select
										id="language"
										bind:value={selectedLocale}
										class="border-line-strong bg-surface-raised text-ink focus:border-accent focus:ring-accent w-full appearance-none rounded-md border px-4 py-2 pr-8 transition-colors focus:ring-2"
									>
										{#each Object.entries(locales) as [code, [native]] (code)}
											<option value={code}>{native}</option>
										{/each}
									</select>
									<div
										class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2"
									>
										<svg
											class="text-ink-muted h-5 w-5"
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
								<p class="text-ink-muted mt-1 text-sm">Set the language for the citation</p>
							</div>
						</div>
					</Tabs.Content>

					<!-- Appearance Settings -->
					<Tabs.Content value="page" class="absolute inset-0 overflow-y-auto p-5">
						<h3 class="border-line text-ink mb-4 border-b pb-2 text-lg font-medium">Page setup</h3>
						<PageSetupSettings />
					</Tabs.Content>

					<Tabs.Content value="appearance" class="absolute inset-0 overflow-y-auto p-5">
						<div class="mb-8">
							<h3 class="border-line text-ink mb-4 border-b pb-2 text-lg font-medium">
								Appearance
							</h3>

							<AppearanceSettings />
						</div>
					</Tabs.Content>
				</div>
			</Tabs.Root>

			<!-- Footer -->
			<div class="border-line bg-surface-sunken flex justify-end space-x-3 border-t px-5 py-4">
				<Dialog.Close
					class="border-line-strong text-ink hover:bg-surface-hover rounded border px-4 py-2 transition-colors"
				>
					Cancel
				</Dialog.Close>
				<button
					class="border-accent bg-accent text-accent-ink hover:bg-accent-hover rounded border px-4 py-2 transition-colors"
					onclick={saveSettings}
				>
					Save changes
				</button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
