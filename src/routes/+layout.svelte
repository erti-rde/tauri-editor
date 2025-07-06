<script lang="ts">
	import { Toast } from '$lib';
	import '../global.css';

	let { children } = $props();
</script>

<Toast />
{@render children()}
