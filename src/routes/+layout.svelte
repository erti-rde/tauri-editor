<script lang="ts">
	import { onMount } from 'svelte';

	import { Toast } from '$lib';
	import { appearanceStore } from '$lib/theme/appearanceStore';
	import '../global.css';

	let { children } = $props();

	// The inline script in app.html has already set a theme from the OS, so this
	// only corrects it to whatever the user chose. Doing it here rather than
	// there keeps the settings file out of the critical path.
	onMount(() => void appearanceStore.initialise());
</script>

<Toast />
{@render children()}
