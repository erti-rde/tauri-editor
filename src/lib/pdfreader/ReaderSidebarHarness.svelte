<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { Tooltip } from 'bits-ui';

	import ReaderSidebar from './ReaderSidebar.svelte';

	/**
	 * The reader's panel, with the one ancestor it cannot mount without.
	 *
	 * Its tabs use bits-ui tooltips, which throw outside a Provider — the
	 * application has one at the layout root, so this stands in for it. Named
	 * without `.test` so Vitest does not try to collect it as a suite.
	 */
	const props: ComponentProps<typeof ReaderSidebar> = $props();
</script>

<Tooltip.Provider>
	<ReaderSidebar {...props} />
</Tooltip.Provider>
