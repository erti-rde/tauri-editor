<script lang="ts">
	import { onMount } from 'svelte';

	import { Tooltip } from 'bits-ui';

	import { Toast } from '$lib';
	import { catchUnhandled } from '$lib/log';
	import { errorToast } from '$lib/toast/Toast.svelte';
	import { appearanceStore } from '$lib/theme/appearanceStore';
	import '../global.css';

	let { children } = $props();

	// The inline script in app.html has already set a theme from the OS, so this
	// only corrects it to whatever the user chose. Doing it here rather than
	// there keeps the settings file out of the critical path.
	onMount(() => void appearanceStore.initialise());

	// Anything thrown that nothing caught is logged and said, not lost (M1a-12).
	onMount(() => catchUnhandled(window, errorToast));
</script>

<!--
	bits-ui's Tooltip needs a Provider ancestor: it owns the shared open/close
	timing so that moving between two buttons does not replay the delay. One at
	the root covers every tooltip in the app, and without it the components throw
	on mount — which took the editor down rather than merely losing the tooltips.
-->
<Tooltip.Provider delayDuration={400} skipDelayDuration={300}>
	<Toast />
	{@render children()}
</Tooltip.Provider>
