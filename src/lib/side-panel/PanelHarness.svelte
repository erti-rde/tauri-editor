<script lang="ts">
	import { Tooltip } from 'bits-ui';

	import Panel from './Panel.svelte';
	import type { PanelNames } from '$types/page';

	/**
	 * The rail with the provider the app supplies at its root: its controls are
	 * `IconButton`s, whose tooltips throw on mount without one. Named without
	 * the `.test` infix so vitest doesn't collect it as a suite.
	 */
	const { toggleSidePanel }: { toggleSidePanel: (panelName: PanelNames) => void } = $props();
</script>

<Tooltip.Provider>
	<Panel {toggleSidePanel} />
</Tooltip.Provider>
