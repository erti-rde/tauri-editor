<script lang="ts">
	import { Tooltip } from 'bits-ui';

	import TabBar from './TabBar.svelte';
	import type { Pane, Workspace } from './tabs';

	/**
	 * TabBar with the provider the app supplies at its root.
	 *
	 * The split control is a tooltipped button, and bits-ui's Tooltip throws on
	 * mount without a `Tooltip.Provider` ancestor. Named without the `.test`
	 * infix so vitest does not try to collect it as a suite.
	 */
	interface Props {
		pane: Pane;
		workspace: Workspace;
		focused?: boolean;
	}

	const { pane, workspace, focused = true }: Props = $props();
</script>

<Tooltip.Provider>
	<TabBar {pane} {workspace} {focused} />
</Tooltip.Provider>
