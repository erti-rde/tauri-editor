<script lang="ts">
	import { Popover } from 'bits-ui';

	import Icon from '$lib/icon/Icon.svelte';

	import type { ScrollModeName, SpreadModeName } from './viewer';

	/**
	 * How the paper is laid out and how it is lit.
	 *
	 * Zotero keeps these together behind one button rather than spending toolbar
	 * width on them, and it is right to: a reader sets the scroll mode once, on
	 * the day they meet a paper printed sideways or one they want to read as
	 * facing pages, and then never touches it again. Putting six more icons in
	 * the toolbar for that would cost every reader something to serve a few.
	 *
	 * The page tint is Erti's own addition rather than Zotero's. The application
	 * follows a chosen palette everywhere else, and a PDF is the one surface that
	 * stays stark white in a dark room — which is a real complaint about reading
	 * papers at night, not a decoration.
	 */
	export type PageTheme = 'paper' | 'sepia' | 'dark';

	interface Props {
		scrollMode: ScrollModeName;
		spreadMode: SpreadModeName;
		rotation: number;
		pageTheme: PageTheme;
		onscroll: (mode: ScrollModeName) => void;
		onspread: (mode: SpreadModeName) => void;
		onrotate: (degrees: number) => void;
		ontheme: (theme: PageTheme) => void;
	}

	const {
		scrollMode,
		spreadMode,
		rotation,
		pageTheme,
		onscroll,
		onspread,
		onrotate,
		ontheme
	}: Props = $props();

	const scrolls = [
		{ id: 'vertical' as const, icon: 'ScrollVertical' as const, name: 'Vertical' },
		{ id: 'horizontal' as const, icon: 'ScrollHorizontal' as const, name: 'Horizontal' },
		{ id: 'wrapped' as const, icon: 'ScrollWrapped' as const, name: 'Wrapped' }
	];

	const spreads = [
		{ id: 'none' as const, icon: 'SpreadNone' as const, name: 'Single pages' },
		{ id: 'odd' as const, icon: 'SpreadOdd' as const, name: 'Facing, odd on the left' },
		{ id: 'even' as const, icon: 'SpreadEven' as const, name: 'Facing, even on the left' }
	];

	const themes = [
		{
			id: 'paper' as const,
			name: 'Paper',
			hint: 'The page as it was printed',
			swatch: '#ffffff',
			ink: '#111827'
		},
		{
			id: 'sepia' as const,
			name: 'Sepia',
			hint: 'Warmer paper, easier on the eyes for long reading',
			swatch: '#f4ecd8',
			ink: '#5b4636'
		},
		{
			id: 'dark' as const,
			name: 'Night',
			hint: 'A dark page, for reading in a dark room',
			swatch: '#2e3440',
			ink: '#d8dee9'
		}
	];
</script>

<Popover.Root>
	<!--
		A `title` rather than the application's Tooltip, which is the exception
		here and worth saying why. Both components work by handing their trigger's
		props to a child to spread, and one element can only have one `onclick` —
		so nesting them means whichever spreads last silently takes the other's,
		and the popup stops opening. The same reason the label picker beside this
		uses a title.
	-->
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="text-ink-muted hover:bg-surface-hover hover:text-ink rounded p-1 transition-colors"
				aria-label="How the pages are laid out"
				title="How the pages are laid out"
			>
				<Icon icon="PageSetup" size="s" />
			</button>
		{/snippet}
	</Popover.Trigger>

	<Popover.Portal>
		<Popover.Content
			side="bottom"
			align="end"
			sideOffset={6}
			class="border-line bg-surface-overlay z-50 w-64 rounded-md border p-3 shadow-lg"
		>
			<div>
				{#snippet row(title: string, children: import('svelte').Snippet)}
					<div class="mb-3 flex items-center justify-between gap-3">
						<span class="text-ink-muted text-xs">{title}</span>
						<div
							class="border-line flex overflow-hidden rounded border"
							role="group"
							aria-label={title}
						>
							{@render children()}
						</div>
					</div>
				{/snippet}

				{#snippet choice(
					name: string,
					icon:
						| 'ScrollVertical'
						| 'ScrollHorizontal'
						| 'ScrollWrapped'
						| 'SpreadNone'
						| 'SpreadOdd'
						| 'SpreadEven',
					active: boolean,
					action: () => void
				)}
					<button
						class="px-2 py-1 transition-colors {active
							? 'bg-surface-active text-ink'
							: 'text-ink-muted hover:bg-surface-hover hover:text-ink'}"
						aria-pressed={active}
						title={name}
						aria-label={name}
						onclick={action}
					>
						<Icon {icon} size="s" />
					</button>
				{/snippet}

				{#snippet scrollRow()}
					{#each scrolls as mode (mode.id)}
						{@render choice(mode.name, mode.icon, scrollMode === mode.id, () => onscroll(mode.id))}
					{/each}
				{/snippet}

				{#snippet spreadRow()}
					{#each spreads as mode (mode.id)}
						{@render choice(mode.name, mode.icon, spreadMode === mode.id, () => onspread(mode.id))}
					{/each}
				{/snippet}

				{@render row('Scrolling', scrollRow)}
				{@render row('Pages', spreadRow)}

				<div class="mb-3 flex items-center justify-between gap-3">
					<span class="text-ink-muted text-xs">
						Rotation{rotation ? ` · ${rotation}°` : ''}
					</span>
					<div
						class="border-line flex overflow-hidden rounded border"
						role="group"
						aria-label="Rotation"
					>
						<button
							class="text-ink-muted hover:bg-surface-hover hover:text-ink px-2 py-1 transition-colors"
							title="Turn the pages left"
							aria-label="Turn the pages left"
							onclick={() => onrotate(-90)}
						>
							<Icon icon="RotateLeft" size="s" />
						</button>
						<button
							class="text-ink-muted hover:bg-surface-hover hover:text-ink px-2 py-1 transition-colors"
							title="Turn the pages right"
							aria-label="Turn the pages right"
							onclick={() => onrotate(90)}
						>
							<Icon icon="RotateRight" size="s" />
						</button>
					</div>
				</div>

				<div class="bg-line mb-3 h-px" aria-hidden="true"></div>

				<!--
				Named as well as shown. Three coloured squares in a row say nothing
				about which is which to anyone reading them in greyscale, and the
				word is the whole point of the setting.
			-->
				<span class="text-ink-muted mb-1.5 block text-xs">Page colour</span>
				<div class="flex gap-2" role="group" aria-label="Page colour">
					{#each themes as theme (theme.id)}
						<button
							class="border-line grow rounded border px-2 py-1.5 text-xs transition-shadow"
							style:background={theme.swatch}
							style:color={theme.ink}
							style:outline={pageTheme === theme.id ? '2px solid hsl(var(--accent))' : 'none'}
							style:outline-offset="1px"
							aria-pressed={pageTheme === theme.id}
							title={theme.hint}
							onclick={() => ontheme(theme.id)}
						>
							{theme.name}
						</button>
					{/each}
				</div>
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
