<script lang="ts">
	import { Tabs } from 'bits-ui';
	import type { Snippet } from 'svelte';

	/**
	 * Sections of one surface. Arrow keys move between tabs; one panel shows at
	 * a time. Horizontal tabs are underlined, as in the source sidebar;
	 * vertical ones are a side list, as in Settings.
	 */
	interface Props {
		/** What the tabs divide, read as the tab list's name. */
		label: string;
		tabs: { value: string; label: string; disabled?: boolean }[];
		value?: string;
		onValueChange?: (value: string) => void;
		orientation?: 'horizontal' | 'vertical';
		/** One panel, given the tab it's for. */
		panel: Snippet<[string]>;
	}

	let {
		label,
		tabs,
		value = $bindable(tabs[0]?.value ?? ''),
		onValueChange,
		orientation = 'horizontal',
		panel
	}: Props = $props();

	const vertical = $derived(orientation === 'vertical');
</script>

<Tabs.Root
	bind:value
	{onValueChange}
	{orientation}
	class={['flex min-h-0 flex-1', vertical ? 'flex-row' : 'flex-col']}
>
	<Tabs.List
		aria-label={label}
		class={vertical
			? 'border-line bg-surface-sunken flex w-48 shrink-0 flex-col border-r'
			: 'border-line text-small flex gap-4 border-b px-3'}
	>
		{#each tabs as tab (tab.value)}
			<Tabs.Trigger
				value={tab.value}
				disabled={tab.disabled}
				class={[
					'text-ink-muted hover:text-ink border-transparent text-left transition-colors duration-(--duration-fast) disabled:opacity-50',
					'data-[state=active]:text-ink data-[state=active]:border-accent data-[state=active]:font-medium',
					vertical
						? 'text-body hover:bg-surface-hover data-[state=active]:bg-surface-raised border-l-2 px-4 py-2.5'
						: 'border-b-2 pt-2 pb-1.5'
				]}
			>
				{tab.label}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>

	<!-- The panel fills what the tabs are given and scrolls inside it, or is as
	     tall as its content where the parent sets no height. -->
	<div class="bg-surface-raised min-h-0 flex-1">
		{#each tabs as tab (tab.value)}
			<Tabs.Content value={tab.value} class="h-full overflow-y-auto p-5">
				{@render panel(tab.value)}
			</Tabs.Content>
		{/each}
	</div>
</Tabs.Root>
