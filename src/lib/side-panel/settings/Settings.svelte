<script lang="ts">
	import ChevronDown from '~icons/lucide/chevron-down';

	import {
		Button,
		Checkbox,
		Dialog,
		NumberField,
		SearchField,
		Switch,
		Tabs,
		TextField
	} from '$lib/ui';
	import { controlClass } from '$lib/ui/Field.svelte';

	import AppearanceSettings from './AppearanceSettings.svelte';
	import PageSetupSettings from './PageSetupSettings.svelte';
	import LibrarySettings from './LibrarySettings.svelte';
	import LogSettings from './LogSettings.svelte';
	import ReadingSettings from './ReadingSettings.svelte';
	import { autoReferences } from '$lib/editor/references/referencesStore';
	import { onMount } from 'svelte';
	import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
	import { readSetting, writeSetting } from '$lib/settings';
	import { getConsent, getMailto, setConsent, setMailto } from '$lib/stores/consent';
	import { errorToast } from '$lib/ui/Toast.svelte';
	import {
		bundledStyleByName,
		isBundledLocale,
		parseManifest,
		type BundledManifest
	} from '$lib/citations/bundled';
	import { log } from '$lib/log';

	interface Props {
		isOpen: boolean;
		closeSettings: () => void;
	}

	const { isOpen = false, closeSettings }: Props = $props();

	let wordCount = $state(0);
	let selectedStyle = $state('');
	let selectedLocale = $state('');
	let citationStyles: { name: string; download_url: string }[] = $state([]);
	let locales: { [key: string]: string[] } = $state({});
	const SECTIONS = [
		{ value: 'general', label: 'General' },
		{ value: 'citations', label: 'Citations' },
		{ value: 'reading', label: 'Reading' },
		{ value: 'page', label: 'Page setup' },
		{ value: 'appearance', label: 'Appearance' },
		{ value: 'library', label: 'Library' }
	];

	let activeTab = $state('general');
	let styleFilter = $state('');

	// The styles that ship with Erti (M0-3). They're listed first and apply
	// without a download, so choosing one works offline and needs no consent.
	let bundled = $state<BundledManifest | null>(null);
	const bundledNames = $derived(new Set(bundled?.styles.map((style) => style.name) ?? []));

	// The online index lists every independent CSL style, close to three
	// thousand, which is far too many to scroll through. Bundled ones are listed
	// once, in their own group, rather than again here.
	const onlineStyles = $derived(citationStyles.filter((style) => !bundledNames.has(style.name)));

	const query = $derived(styleFilter.trim().toLowerCase());

	const matchingBundled = $derived(
		(bundled?.styles ?? []).filter(
			(style) =>
				!query ||
				style.label.toLowerCase().includes(query) ||
				style.name.toLowerCase().includes(query)
		)
	);

	const matchingStyles = $derived(
		query ? onlineStyles.filter((style) => style.name.toLowerCase().includes(query)) : onlineStyles
	);

	// Keep the current selection rendered, otherwise narrowing the list would
	// drop the <select> binding to the first remaining option. It is shown, but
	// not counted as a match: the count answers the question that was typed.
	const visibleStyles = $derived.by(() => {
		const selected = onlineStyles.find((style) => style.name === selectedStyle);
		return selected && !matchingStyles.includes(selected)
			? [selected, ...matchingStyles]
			: matchingStyles;
	});
	const visibleBundled = $derived.by(() => {
		const selected = bundled?.styles.find((style) => style.name === selectedStyle);
		return selected && !matchingBundled.includes(selected)
			? [selected, ...matchingBundled]
			: matchingBundled;
	});

	const readResource = (path: string) =>
		readTextFile(`resources/csl/${path}`, { baseDir: BaseDirectory.Resource });

	/** Said when something has to be downloaded but lookups are off. */
	const needsLookups = (what: string) =>
		`${what} has to be downloaded, and lookups are off. Choose one that's included with Erti, or turn on "Look up citation details online" in General.`;

	// Governs every outbound request: metadata lookups and citation-style
	// downloads alike.
	let allowNetwork = $state(false);
	// Save waits for consent to be read, or it would refuse downloads and write
	// "declined" over an answer it hadn't seen yet.
	let consentRead = $state(false);
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
			log.error('Error loading resources', error);
			errorToast('Could not load the bundled citation styles.');
		}

		// Separately, so a damaged index doesn't hide the styles that ship with the
		// app, and the other way round.
		try {
			bundled = parseManifest(JSON.parse(await readResource('bundled.json')));
		} catch (error) {
			log.error('Could not read the bundled citation styles', error);
			bundled = null;
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
		if (!consentRead) return;
		try {
			let styleHasChanged = false;
			let localeHasChanged = false;
			let wordCountHasChanged = false;
			// Save citation style
			let oldStyle = await readSetting('selectedStyle');
			let oldStyleXml = await readSetting('cslXml');
			let oldWordCount = await readSetting('wordCount');

			if (oldStyle !== selectedStyle || !oldStyleXml) {
				await writeSetting('selectedStyle', selectedStyle);
				const bundledStyle = bundled ? bundledStyleByName(bundled, selectedStyle) : null;
				const style = citationStyles.find((style) => style.name === selectedStyle);
				if (bundledStyle) {
					try {
						const styleXml = await readResource(bundledStyle.file);
						if (!styleXml.trim().startsWith('<')) {
							throw new Error(
								`"${bundledStyle.label}" could not be read. Reinstalling Erti will fix this.`
							);
						}
						await writeSetting('cslXml', styleXml);
						styleHasChanged = true;
					} catch (error) {
						await writeSetting('selectedStyle', oldStyle);
						selectedStyle = oldStyle ?? '';
						throw error;
					}
				} else if (style) {
					try {
						// The README promises nothing leaves the machine without consent,
						// and a style download is one of the things it lists.
						if (!allowNetwork) throw new Error(needsLookups(`"${selectedStyle}"`));
						const response = await fetch(style.download_url);
						if (!response.ok) {
							// A 404 means the bundled index has drifted from the upstream
							// style repository; `pnpm csl:check` catches that in CI.
							throw new Error(
								response.status === 404
									? `"${selectedStyle}" is no longer published by the CSL style repository. Please choose another style.`
									: `Could not download "${selectedStyle}" (HTTP ${response.status}). Check your connection and try again.`
							);
						}
						const styleXml = await response.text();

						// Verify that we received valid XML
						if (!styleXml || !styleXml.trim().startsWith('<')) {
							throw new Error(`"${selectedStyle}" could not be read as a citation style.`);
						}

						await writeSetting('cslXml', styleXml);
						styleHasChanged = true;
					} catch (error) {
						log.error('Error fetching style', error);
						// If fetch fails, keep the old style selected
						await writeSetting('selectedStyle', oldStyle);
						selectedStyle = oldStyle ?? '';
						throw error;
					}
				}
			}

			// Save locale
			let oldLocale = await readSetting('selectedLocale');
			let oldLocaleXml = await readSetting('localeXml');

			if (oldLocale !== selectedLocale || !oldLocaleXml) {
				await writeSetting('selectedLocale', selectedLocale);
				// Construct the URL for the locale XML file
				const localeUrl = `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${selectedLocale}.xml`;

				try {
					if (bundled && isBundledLocale(bundled, selectedLocale)) {
						const localeXml = await readResource(bundled.locales[selectedLocale]);
						if (!localeXml.trim().startsWith('<')) {
							throw new Error(`The ${selectedLocale} citation language could not be read.`);
						}
						await writeSetting('localeXml', localeXml);
						localeHasChanged = true;
					} else {
						if (!allowNetwork) {
							throw new Error(needsLookups(`The ${selectedLocale} citation language`));
						}
						const response = await fetch(localeUrl);
						if (!response.ok) {
							throw new Error(
								`Could not download the ${selectedLocale} citation language (HTTP ${response.status}).`
							);
						}
						const localeXml = await response.text();

						// Verify that we received valid XML
						if (!localeXml || !localeXml.trim().startsWith('<')) {
							throw new Error(`The ${selectedLocale} citation language could not be read.`);
						}

						await writeSetting('localeXml', localeXml);
						localeHasChanged = true;
					}
				} catch (error) {
					log.error('Error fetching locale', error);
					// If fetch fails, keep the old locale selected
					await writeSetting('selectedLocale', oldLocale);
					selectedLocale = oldLocale ?? 'en-GB';
					throw error;
				}
			}

			if (oldWordCount !== wordCount) {
				await writeSetting('wordCount', wordCount);
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
			log.error('Error saving settings', error);
			// The dialog stays open so the failed choice can be corrected. The error
			// used to go only to a console nobody has open, and the style simply
			// did not change.
			errorToast(error instanceof Error ? error.message : 'Could not save your settings.');
		}
	}

	// Consent is read each time the dialog opens, not once on mount. Settings is
	// mounted from launch, so on a first launch it mounted before the consent
	// question was answered: after "Allow lookups" it still refused downloads,
	// and saving wrote "declined" back over the answer (found by M6-4's capture).
	$effect(() => {
		consentRead = false;
		if (!isOpen) return;
		// A read from an earlier opening may answer late, with what consent was
		// before the question was answered; only this opening's read counts.
		let current = true;
		void getConsent().then((consent) => {
			if (!current) return;
			allowNetwork = consent === 'granted';
			consentRead = true;
		});
		return () => (current = false);
	});

	onMount(async () => {
		wordCount = await readSetting('wordCount');
		selectedStyle = (await readSetting('selectedStyle')) || '';
		selectedLocale = (await readSetting('selectedLocale')) || 'en-GB';
		crossrefMailto = (await getMailto()) ?? '';
		// The editor initialises this too, but Settings opens from the landing
		// screen where there is no editor — without this the box would show the
		// default rather than the choice someone already made.
		await autoReferences.initialise();
		await loadResources();
		// Nothing chosen yet means the bundled default is in use, so show that
		// rather than an empty "Select a style".
		if (!selectedStyle && bundled) {
			const manifest = bundled;
			selectedStyle = manifest.styles.find((style) => style.id === manifest.default.style)!.name;
		}
	});

	// Every tab's title, as Library's has been since M5-10.
	const heading = 'text-heading text-ink mb-3 font-medium';
	// A native select drawn as a field, its arrow the app's own.
	const select = 'h-(--row-height) appearance-none pr-7 pl-2';
	const chevron =
		'text-ink-muted pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2';
</script>

<!--
	The Dialog and Tabs primitives (ADR 010), on bits-ui rather than hand-rolled.
	What that buys is not styling — it is the behaviour a modal has to have and
	this one did not: Escape closes it, focus is trapped inside and restored to
	whatever opened it, the page behind is inert and does not scroll, and screen
	readers are told it is a dialog rather than reading a div.
	The tabs likewise gain arrow-key navigation and the roles that make them tabs.
-->
<Dialog
	open={isOpen}
	onOpenChange={(open) => !open && closeSettings()}
	title="Settings"
	closeLabel="Close settings"
	size="lg"
	flush
>
	<Tabs label="Settings sections" tabs={SECTIONS} bind:value={activeTab} orientation="vertical">
		{#snippet panel(tab)}
			{#if tab === 'general'}
				<h3 class={heading}>General</h3>
				<div class="grid gap-5">
					<NumberField
						label="Word-count target"
						hint="The status bar counts towards it, and says when you're over."
						unit="words"
						min={0}
						max={1000000}
						step={100}
						bind:value={wordCount}
						class="w-40"
					/>

					<!-- Held until consent has been read, or a late read would put back
					     what the person had just changed. A Checkbox rather than a
					     Switch: like the rest of this tab, it waits for Save. -->
					<Checkbox
						label="Look up citation details online"
						description="Sends a paper's identifier — or its title and the opening of its first page — to doi.org and crossref.org, and allows citation styles to be downloaded. With this off, Erti reads the identifier printed in each paper and nothing leaves your machine."
						bind:checked={allowNetwork}
						disabled={!consentRead}
					/>

					{#if allowNetwork}
						<TextField
							label="Contact address for Crossref (optional)"
							hint="Crossref asks API users to identify themselves and gives those requests better service. Yours to provide or leave blank."
							type="email"
							bind:value={crossrefMailto}
							placeholder="you@university.edu"
						/>
					{/if}

					<LogSettings />
				</div>
			{:else if tab === 'citations'}
				<h3 class={heading}>Citations</h3>
				<div class="grid gap-5">
					<!-- Applied at once by the store, so a Switch. -->
					<Switch
						label="Add a reference list automatically"
						description="The first citation in a document brings a works-cited list with it. Delete the list and it stays deleted — this only ever adds the first one."
						checked={$autoReferences}
						onCheckedChange={(on) => void autoReferences.update(on)}
					/>

					<!--
						Native selects, styled as fields, rather than the Select primitive:
						the style list runs to some three thousand, in two groups, and
						Select has no groups and draws every option. The ids are what the
						real-app journeys choose a style by (e2e-app/specs/app.mjs).
					-->
					<div class="grid gap-1">
						<label for="citation-style" class="text-small text-ink font-medium">
							Citation style
						</label>
						<SearchField label="Filter citation styles" bind:value={styleFilter} />
						<div class="relative">
							<select
								id="citation-style"
								bind:value={selectedStyle}
								aria-describedby="citation-style-note"
								class={[controlClass, select]}
							>
								<option value="" disabled>Select a style</option>
								{#if visibleBundled.length > 0}
									<optgroup label="Included with Erti">
										{#each visibleBundled as style (style.id)}
											<option value={style.name}>{style.label}</option>
										{/each}
									</optgroup>
								{/if}
								<optgroup label={allowNetwork ? 'Download' : 'Download (needs lookups on)'}>
									{#each visibleStyles as style (style.download_url)}
										<option value={style.name}>{style.name}</option>
									{/each}
								</optgroup>
							</select>
							<ChevronDown class={chevron} aria-hidden="true" />
						</div>
						<p id="citation-style-note" class="text-caption text-ink-muted">
							{#if styleFilter.trim()}
								{matchingBundled.length + matchingStyles.length} of {(bundled?.styles.length ?? 0) +
									onlineStyles.length} styles match "{styleFilter.trim()}"
							{:else}
								Choose your preferred citation style for references ({(bundled?.styles.length ??
									0) + onlineStyles.length}
								available)
							{/if}
						</p>
					</div>

					<div class="grid gap-1">
						<label for="language" class="text-small text-ink font-medium">Citation language</label>
						<div class="relative">
							<select
								id="language"
								bind:value={selectedLocale}
								aria-describedby="language-note"
								class={[controlClass, select]}
							>
								{#each Object.entries(locales) as [code, [native]] (code)}
									<option value={code}>{native}</option>
								{/each}
							</select>
							<ChevronDown class={chevron} aria-hidden="true" />
						</div>
						<p id="language-note" class="text-caption text-ink-muted">
							Set the language for the citation
						</p>
					</div>
				</div>
			{:else if tab === 'reading'}
				<h3 class={heading}>Reading</h3>
				<ReadingSettings />
			{:else if tab === 'page'}
				<h3 class={heading}>Page setup</h3>
				<PageSetupSettings />
			{:else if tab === 'appearance'}
				<h3 class={heading}>Appearance</h3>
				<AppearanceSettings />
			{:else if tab === 'library'}
				<h3 class={heading}>Library</h3>
				<LibrarySettings />
			{/if}
		{/snippet}
	</Tabs>

	{#snippet footer()}
		<Button onclick={closeSettings}>Cancel</Button>
		<Button variant="primary" disabled={!consentRead} onclick={saveSettings}>Save changes</Button>
	{/snippet}
</Dialog>
