<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import Check from '~icons/lucide/check';
	import ChevronDown from '~icons/lucide/chevron-down';
	import Pencil from '~icons/lucide/pencil';

	import type { AnnotationLabel } from '$lib/stores/db';

	/**
	 * Which colour the next mark takes, and what that colour means.
	 *
	 * The swatch row in the selection popup is quick but mute: eight squares say
	 * nothing about which one is `Limitation`, and a reader who has renamed them
	 * has no way to check without opening Settings. So this lists them by name,
	 * ticks the one in force, and lets a name be changed where it is read rather
	 * than somewhere else in the application.
	 */
	interface Props {
		labels: AnnotationLabel[];
		current: string | null;
		onchoose: (labelId: string) => void;
		onrename: (label: AnnotationLabel, name: string) => void;
		/** Give every label its colour's name back, for readers who prefer that. */
		onresetnames: () => void;
	}

	const { labels, current, onchoose, onrename, onresetnames }: Props = $props();

	let open = $state(false);
	let editing = $state<string | null>(null);

	const usable = $derived(labels.filter((label) => label.enabled));
	const active = $derived(usable.find((label) => label.id === current) ?? usable[0]);

	function commit(label: AnnotationLabel, value: string) {
		const name = value.trim();
		editing = null;
		if (name && name !== label.name) onrename(label, name);
	}
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="text-ink-muted hover:bg-surface-hover hover:text-ink flex items-center gap-0.5 rounded p-1 transition-colors"
				aria-label={active ? `Highlight colour: ${active.name}` : 'Highlight colour'}
				title={active ? `Highlight colour: ${active.name}` : 'Highlight colour'}
			>
				<span
					class="ring-line-strong inline-block h-4 w-4 rounded-full ring-1 ring-inset"
					style:background="hsl({active?.colour ?? '45 90% 60%'})"
				></span>
				<ChevronDown class="icon" width="10" height="10" />
			</button>
		{/snippet}
	</DropdownMenu.Trigger>

	<DropdownMenu.Portal>
		<DropdownMenu.Content
			sideOffset={6}
			align="start"
			class="border-line bg-surface-overlay z-50 min-w-52 rounded border py-1 shadow-md"
		>
			{#each usable as label (label.id)}
				{#if editing === label.id}
					<!--
						Kept out of the menu's own item handling while typing: a menu
						treats letter keys as type-ahead and would jump the highlight to
						another row on the first character.
					-->
					<div class="flex items-center gap-2 px-2 py-1">
						<span
							class="border-line inline-block h-3.5 w-3.5 shrink-0 rounded-sm border"
							style:background="hsl({label.colour})"
						></span>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="border-line bg-surface-sunken text-ink w-full rounded border px-1 py-0.5 text-xs"
							aria-label="Name for this label"
							value={label.name}
							autofocus
							onkeydown={(event) => {
								event.stopPropagation();
								if (event.key === 'Enter') commit(label, event.currentTarget.value);
								if (event.key === 'Escape') editing = null;
							}}
							onblur={(event) => commit(label, event.currentTarget.value)}
						/>
					</div>
				{:else}
					<!--
						Plain buttons rather than `DropdownMenu.Item`. An Item is built to
						select and close, so the rename control nested inside one was
						racing it: the menu shut on the way to the input, intermittently,
						which is the worst way for a control to behave. The Content around
						them still supplies the portal, the positioning, Escape and
						dismissal on an outside click.
					-->
					<div class="hover:bg-surface-hover flex items-center gap-2 px-2 py-1 text-xs">
						<button
							class="text-ink flex grow items-center gap-2 text-left"
							onclick={() => {
								onchoose(label.id);
								open = false;
							}}
							aria-pressed={label.id === active?.id}
						>
							<span class="w-3 shrink-0">
								{#if label.id === active?.id}
									<Check class="icon" width="12" height="12" />
								{/if}
							</span>

							<span
								class="ring-line-strong inline-block h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-inset"
								style:background="hsl({label.colour})"
							></span>

							<span>{label.name}</span>
						</button>

						<!--
							On press rather than on click, which is not a detail. A click
							is only complete on mouse-*up*, and by then the menu's own
							dismissal has run: the row is gone, this button with it, and
							the handler sets a value on a subtree that no longer exists.
							The rename simply did not happen, intermittently. Pressing is
							also what a menu row does, so the hand notices nothing.
						-->
						<button
							class="text-ink-faint hover:text-ink shrink-0 rounded p-0.5"
							aria-label="Rename {label.name}"
							title="Rename"
							onpointerdown={(event) => {
								event.preventDefault();
								editing = label.id;
							}}
						>
							<Pencil class="icon" width="11" height="11" />
						</button>
					</div>
				{/if}
			{/each}

			{#if usable.length === 0}
				<p class="text-ink-muted px-2 py-1 text-xs">
					No labels. Settings → Reading can put them back.
				</p>
			{/if}

			<!--
				Erti has an opinion about what a highlight means and it is only a
				suggestion. Plenty of researchers already know what their own yellow
				means, and Zotero's colours are simply called Yellow and Red — so
				naming a colour after itself is offered here, where the names are
				being read, rather than only in Settings.
			-->
			<div class="bg-line my-1 h-px" aria-hidden="true"></div>

			<button
				class="text-ink-muted hover:bg-surface-hover hover:text-ink w-full px-2 py-1 text-left text-xs"
				onclick={() => {
					onresetnames();
					open = false;
				}}
			>
				Name them after their colours
			</button>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
