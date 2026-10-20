<script lang="ts">
	import RadioCard from './RadioCard.svelte';
	import RadioCardGroup from './RadioCardGroup.svelte';
	import SettingRow from './SettingRow.svelte';

	/** Two settings as a Settings tab builds them: a button, then a group of cards. */
	let { onchange = () => {} }: { onchange?: (value: string) => void } = $props();

	let density = $state('compact');
</script>

<SettingRow label="Location" hint="~/Erti/library.db">
	{#snippet children({ labelId, hintId })}
		<button type="button" aria-describedby="{labelId} {hintId}">Move library…</button>
	{/snippet}
</SettingRow>
<SettingRow label="Density" hint="How much fits on screen at once." stacked>
	{#snippet children({ labelId, hintId })}
		<RadioCardGroup
			aria-labelledby={labelId}
			aria-describedby={hintId}
			bind:value={density}
			onValueChange={onchange}
		>
			<RadioCard value="compact" label="Compact" description="Rows like a code editor" />
			<RadioCard value="comfortable" label="Comfortable" description="More room to click" />
			<RadioCard value="roomy" label="Roomy" disabled />
		</RadioCardGroup>
	{/snippet}
</SettingRow>
