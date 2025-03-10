<script lang="ts">
	import { Toast } from '$lib';
	import '../global.css';

	let { children } = $props();
</script>

<div class="fixed w-full">
	<Toast />
	{@render children()}
</div>
