<script lang="ts">
	import { Tooltip as BitsTooltip } from 'bits-ui';

	import Tooltip from './Tooltip.svelte';

	/** Renders a tooltipped button with or without the app's provider. */
	const { withProvider = true }: { withProvider?: boolean } = $props();
</script>

{#snippet control()}
	<!-- A button, because that is what every real consumer passes. When this was
	     a <span> the suite was green while the toolbar shipped a button nested
	     inside the trigger's button. -->
	<Tooltip label="Insert a page break" shortcut="Mod Enter">
		{#snippet children(tooltip)}
			<button {...tooltip}>icon</button>
		{/snippet}
	</Tooltip>
{/snippet}

{#if withProvider}
	<BitsTooltip.Provider>
		{@render control()}
	</BitsTooltip.Provider>
{:else}
	{@render control()}
{/if}
