<script lang="ts">
	import { Tooltip } from 'bits-ui';

	import PdfReader from './PdfReader.svelte';

	/**
	 * The reader, with the one ancestor it cannot mount without.
	 *
	 * Its toolbar uses bits-ui tooltips, which throw outside a Provider — the
	 * application has one at the layout root, so this stands in for it. Named
	 * without `.test` so Vitest does not try to collect it as a suite.
	 *
	 * The delay is left at the default, as the other harnesses leave it. Setting
	 * it to zero makes every simulated click open and then tear down a tooltip,
	 * and bits-ui warns from inside that teardown — a hundred lines of noise
	 * about this component's own code being fine.
	 */
	interface Props {
		path: string;
		paneId?: string;
	}

	const { path, paneId = 'pane-1' }: Props = $props();
</script>

<Tooltip.Provider>
	<PdfReader {path} {paneId} />
</Tooltip.Provider>
