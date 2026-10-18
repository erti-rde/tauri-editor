<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import Bold from '~icons/lucide/bold';
	import Italic from '~icons/lucide/italic';
	import Undo from '~icons/lucide/undo-2';

	import IconButton from './IconButton.svelte';
	import Menu from './Menu.svelte';
	import NumberField from './NumberField.svelte';
	import ToggleButton from './ToggleButton.svelte';
	import Toolbar from './Toolbar.svelte';
	import ToolbarGroup from './ToolbarGroup.svelte';

	/** A toolbar as the editor builds one, between two things to tab to. */
	let { onsize = () => {} }: { onsize?: (size: number) => void } = $props();

	let bold = $state(true);
	let italic = $state(false);
	let size = $state(16);
</script>

<Tooltip.Provider>
	<button type="button">Before</button>
	<Toolbar label="Formatting">
		<ToolbarGroup>
			<IconButton label="Undo" icon={Undo} />
			<IconButton label="Redo" icon={Undo} disabled />
		</ToolbarGroup>
		<ToolbarGroup>
			<NumberField
				label="Font size"
				hideLabel
				floatNote
				bind:value={size}
				min={8}
				max={72}
				unit="px"
				steppers
				stepLabels={['Smaller', 'Larger']}
				noun="a size"
				onchange={onsize}
			/>
		</ToolbarGroup>
		<ToolbarGroup>
			<ToggleButton label="Bold" icon={Bold} pressed={bold} onclick={() => (bold = !bold)} />
			<ToggleButton
				label="Italic"
				icon={Italic}
				pressed={italic}
				onclick={() => (italic = !italic)}
			/>
			<Menu label="Text style" items={[{ label: 'Heading 1', onSelect: () => {} }]} />
		</ToolbarGroup>
	</Toolbar>
	<button type="button">After</button>
</Tooltip.Provider>
