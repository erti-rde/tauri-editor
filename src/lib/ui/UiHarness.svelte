<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { Component } from 'svelte';

	/**
	 * A primitive as the app mounts it: inside the tooltip provider the root
	 * supplies. Tests render this with the primitive and its props.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let { component: Primitive, ...props }: { component: Component<any> } & Record<string, unknown> =
		$props();
</script>

<Tooltip.Provider>
	<Primitive {...props} />
</Tooltip.Provider>
