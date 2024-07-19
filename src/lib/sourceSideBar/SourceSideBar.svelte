<script lang="ts">
	import Separator from '$lib/separator/Separator.svelte';
	import Tree from '$lib/tree/Index.svelte';

	import { getSources } from '$lib/tree/Index.svelte';
	import AddSource from './AddSource.svelte';

	import type { TreeItem } from '$lib/tree/index.svelte';

	let treeItems: TreeItem[] | undefined = [];

	getSources().then((sources) => {
		treeItems = sources;
	});

	async function updateTreeItems() {
		treeItems = await getSources();
	}

</script>

<div class="ml-[10px] flex flex-col justify-between">
	<Tree {treeItems} />
	<AddSource on:sourceAdded={updateTreeItems} />
</div>
<Separator orientation="vertical" />
