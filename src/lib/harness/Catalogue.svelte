<script lang="ts">
	import AlignLeft from '~icons/lucide/align-left';
	import Bold from '~icons/lucide/bold';
	import BookOpen from '~icons/lucide/book-open';
	import Copy from '~icons/lucide/copy';
	import FileText from '~icons/lucide/file-text';
	import Folder from '~icons/lucide/folder';
	import History from '~icons/lucide/history';
	import Pencil from '~icons/lucide/pencil';
	import ImagePlus from '~icons/lucide/image-plus';
	import Italic from '~icons/lucide/italic';
	import Trash from '~icons/lucide/trash-2';
	import Settings from '~icons/lucide/settings';
	import Underline from '~icons/lucide/underline';
	import { CalendarDate } from '@internationalized/date';

	import {
		Banner,
		Button,
		Checkbox,
		Chip,
		ConfirmDialog,
		DateField,
		Dialog,
		DocumentTab,
		EmptyState,
		FindBar,
		IconButton,
		InlineRename,
		Item,
		Kbd,
		LabelChip,
		Loader,
		Menu,
		NumberField,
		Panel,
		Popover,
		ProgressLine,
		RadioCard,
		RadioCardGroup,
		RadioGroup,
		SearchField,
		Select,
		SettingRow,
		Sidebar,
		SplitHandle,
		StatusItem,
		Switch,
		Tabs,
		TextArea,
		TextField,
		ToggleButton,
		Toolbar,
		ToolbarGroup,
		TreeRow,
		type MenuItem
	} from '$lib/ui';
	import { toasts } from '$lib/ui/Toast.svelte';

	import Specimen from './Specimen.svelte';

	/**
	 * Every primitive in every state (M1c-5 AC-1, ADR 010), at `/harness/catalogue`.
	 *
	 * `e2e/catalogue.spec.ts` screenshots it in every palette at both densities,
	 * and measures the contrast of what each specimen actually renders. The
	 * overlays (menu, select, popover, tooltip, dialogs) sit closed here behind
	 * triggers marked `data-overlay`; the spec opens them one at a time.
	 *
	 * A new primitive gets an entry here before anything uses it
	 * (docs/design-system.md).
	 */

	const FORCED = ['hover', 'focus', 'active'] as const;

	const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const;
	const BUTTON_STATES = ['rest', ...FORCED, 'disabled', 'loading'] as const;

	const MENU_ITEMS: MenuItem[] = [
		{ label: 'Paragraph', description: 'Body text', active: true, onSelect: () => {} },
		{ label: 'Heading 1', onSelect: () => {} },
		{ label: 'Heading 2', disabled: true, onSelect: () => {} },
		{
			label: 'Check first…',
			description: 'Changed since the last check',
			separated: true,
			dot: true,
			onSelect: () => {}
		},
		{ label: 'Delete', icon: Trash, danger: true, onSelect: () => {} }
	];

	const DOCUMENT_MENU: MenuItem[] = [
		{ label: 'Rename…', icon: Pencil, onSelect: () => {} },
		{ label: 'Duplicate', icon: Copy, onSelect: () => {} },
		{ label: 'History…', icon: History, onSelect: () => {} },
		{ label: 'Delete…', icon: Trash, danger: true, onSelect: () => {} }
	];

	const TAKEN = ['Literature review', 'Methods'];
	const nameInUse = (name: string) =>
		TAKEN.includes(name) ? `“${name}” is already in this project. Choose another name.` : undefined;

	/** Types a name that's taken, so the field shows what it says about one. */
	function typeTaken(node: HTMLElement) {
		const input = node.querySelector('input');
		if (!input) return;
		input.value = 'Literature review';
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}

	/** Types a size out of range, so the field shows what it says about one. */
	function typeOutOfRange(node: HTMLElement) {
		const input = node.querySelector('input');
		if (!input) return;
		input.value = '140';
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}

	const SOURCE_TYPES = [
		{ value: 'article-journal', label: 'Journal article' },
		{ value: 'book', label: 'Book' },
		{ value: 'chapter', label: 'Book chapter', disabled: true }
	];

	const QUOTE =
		'Self-attention relates every position of a sequence to every other position in a single step, and multi-head attention runs several of these in parallel.';

	let dialogOpen = $state(false);
	let confirmOpen = $state(false);
	let sourceType = $state('book');
	let date = $state(new CalendarDate(2017, 6, 12));

	// Straight into the list the layout's `<Toast />` draws, without the timer
	// `toast()` sets, so they stay for the screenshot: one of each kind.
	toasts.push(
		{
			id: 'catalogue-success',
			kind: 'success',
			title: 'Exported Chapter 1.docx',
			description: 'Saved to Documents › Thesis.',
			action: { label: 'Show in folder', run: () => {} }
		},
		{
			id: 'catalogue-danger',
			kind: 'danger',
			title: 'Could not read the style',
			description: 'The file is not a citation style.'
		},
		{ id: 'catalogue-info', kind: 'info', title: 'Removed “Orality and Literacy”' }
	);
</script>

{#snippet section(title: string)}
	<h2 class="text-heading text-ink border-line col-span-full border-b pb-1 font-semibold">
		{title}
	</h2>
{/snippet}

<main class="bg-surface text-ink min-h-screen p-6">
	<h1 class="text-display mb-6 font-semibold">Catalogue</h1>

	<div class="grid max-w-6xl gap-8">
		<!-- Actions -->
		<section class="grid gap-4">
			{@render section('Button')}
			{#each VARIANTS as variant (variant)}
				<div class="flex flex-wrap gap-6">
					{#each BUTTON_STATES as state (state)}
						<Specimen name="Button {variant}" {state}>
							<Button {variant} disabled={state === 'disabled'} loading={state === 'loading'}>
								{state === 'loading' ? 'Saving…' : 'Save'}
							</Button>
						</Specimen>
					{/each}
					<Specimen name="Button {variant} sm" state="rest">
						<Button {variant} size="sm">Small</Button>
					</Specimen>
				</div>
			{/each}
		</section>

		<section class="grid gap-4">
			{@render section('IconButton')}
			<div class="flex flex-wrap gap-6">
				{#each ['rest', ...FORCED, 'disabled'] as state (state)}
					<Specimen name="IconButton" {state}>
						<IconButton label="Bold" shortcut="Mod B" icon={Bold} disabled={state === 'disabled'} />
					</Specimen>
				{/each}
				<Specimen name="IconButton" state="pressed">
					<IconButton label="Italic" icon={Italic} pressed />
				</Specimen>
				<Specimen name="IconButton sm" state="rest">
					<IconButton label="Settings" icon={Settings} size="sm" />
				</Specimen>
				<Specimen name="Tooltip" state="open">
					<div data-overlay="tooltip">
						<IconButton label="Settings" shortcut="Mod ," icon={Settings} />
					</div>
				</Specimen>
			</div>
		</section>

		<section class="grid gap-4">
			{@render section('Menu')}
			<div class="flex flex-wrap gap-6">
				{#each ['rest', ...FORCED, 'disabled'] as state (state)}
					<Specimen name="Menu trigger" {state}>
						<Menu label="Text style" items={MENU_ITEMS} disabled={state === 'disabled'} />
					</Specimen>
				{/each}
				<Specimen name="Menu" state="open">
					<div data-overlay="menu">
						<Menu label="Insert" items={MENU_ITEMS} />
					</div>
				</Specimen>
			</div>
		</section>

		<section class="grid gap-4">
			{@render section('DocumentTab, InlineRename')}
			<div class="grid gap-6">
				<Specimen name="DocumentTab" state="rest">
					<div class="bg-surface-sunken border-line flex h-8 border-b" role="tablist">
						<DocumentTab
							title="Chapter 1"
							icon={FileText}
							current
							menu={DOCUMENT_MENU}
							onselect={() => {}}
							onclose={() => {}}
						/>
						<DocumentTab title="Literature review" icon={FileText} onselect={() => {}} />
						<DocumentTab
							title="vaswani-2017.pdf"
							icon={BookOpen}
							onselect={() => {}}
							onclose={() => {}}
						/>
					</div>
				</Specimen>
				<div class="flex flex-wrap gap-6">
					{#each FORCED as state (state)}
						<Specimen name="DocumentTab" {state}>
							<div class="bg-surface-sunken flex h-8" role="tablist">
								<DocumentTab
									title="Literature review"
									icon={FileText}
									onselect={() => {}}
									onclose={() => {}}
								/>
							</div>
						</Specimen>
					{/each}
					<Specimen name="DocumentTab renaming" state="focus" target="input">
						<div class="bg-surface-sunken flex h-8" role="tablist">
							<DocumentTab
								title="Chapter 1"
								icon={FileText}
								current
								renaming
								validate={nameInUse}
								onselect={() => {}}
								onrename={() => {}}
							/>
						</div>
					</Specimen>
					<Specimen name="InlineRename" state="error" target="input">
						<div class="bg-surface-sunken flex h-8 items-center px-3" {@attach typeTaken}>
							<InlineRename
								value="Chapter 1"
								label="Name for Chapter 1"
								class="w-40"
								validate={nameInUse}
								oncommit={() => {}}
							/>
						</div>
					</Specimen>
				</div>
			</div>
		</section>

		<!-- Inputs -->
		<section class="grid gap-4">
			{@render section('TextField, TextArea, SearchField')}
			<div class="grid grid-cols-3 gap-6">
				{#each ['rest', ...FORCED] as state (state)}
					<Specimen name="TextField" {state} target="input">
						<TextField label="Title" placeholder="Untitled" hint="As the paper gives it" />
					</Specimen>
				{/each}
				<Specimen name="TextField" state="filled" target="input">
					<TextField label="Title" value="Attention Is All You Need" />
				</Specimen>
				<Specimen name="TextField" state="error" target="input">
					<TextField
						label="DOI"
						value="10.48550"
						error="A DOI has a slash: 10.48550/arXiv.1706.03762"
					/>
				</Specimen>
				<Specimen name="TextField" state="disabled" target="input">
					<TextField label="Title" value="Attention Is All You Need" disabled />
				</Specimen>
				<Specimen name="TextArea" state="rest" target="textarea">
					<TextArea label="Note" placeholder="What does this passage do?" />
				</Specimen>
				<Specimen name="TextArea" state="hover" target="textarea">
					<TextArea label="Note" value="Contradicts the RNN section." />
				</Specimen>
				<Specimen name="TextArea" state="focus" target="textarea">
					<TextArea label="Note" value="Contradicts the RNN section." />
				</Specimen>
				<Specimen name="TextArea" state="error" target="textarea">
					<TextArea label="Note" value="" error="Write a note, or close without saving" />
				</Specimen>
				<Specimen name="TextArea" state="disabled" target="textarea">
					<TextArea label="Note" value="Contradicts the RNN section." disabled />
				</Specimen>
				<Specimen name="SearchField" state="rest" target="input">
					<SearchField label="Search notes" hideLabel placeholder="Search notes" />
				</Specimen>
				<Specimen name="SearchField" state="hover" target="input">
					<SearchField label="Search notes" hideLabel placeholder="Search notes" />
				</Specimen>
				<Specimen name="SearchField" state="filled" target="input">
					<SearchField label="Search notes" hideLabel value="attention" />
				</Specimen>
				<Specimen name="SearchField" state="focus" target="input">
					<SearchField label="Search notes" hideLabel value="attention" />
				</Specimen>
				<Specimen name="SearchField" state="disabled" target="input">
					<SearchField label="Search notes" hideLabel value="attention" disabled />
				</Specimen>
			</div>
		</section>

		<section class="grid gap-4">
			{@render section('FindBar')}
			<div class="grid grid-cols-2 gap-6">
				<Specimen name="FindBar reader" state="rest">
					<FindBar
						label="Find in this paper"
						query="encoder"
						status="7 of 31"
						found
						onstep={() => {}}
						onclose={() => {}}
					/>
				</Specimen>
				<Specimen name="FindBar" state="focus" target="input">
					<FindBar query="encoder" status="7 of 31" found onstep={() => {}} onclose={() => {}} />
				</Specimen>
				<Specimen name="FindBar replacing" state="rest">
					<FindBar
						query="attention"
						status="3 of 12"
						found
						caseSensitive
						wholeWord={false}
						replacing
						replacement="self-attention"
						onstep={() => {}}
						onclose={() => {}}
						onreplace={() => {}}
						onreplaceall={() => {}}
					/>
				</Specimen>
				<Specimen name="FindBar no matches" state="rest">
					<FindBar
						query="atention"
						status="No matches"
						found={false}
						onstep={() => {}}
						onclose={() => {}}
					/>
				</Specimen>
				<Specimen name="FindBar read-only" state="disabled">
					<FindBar
						query="colour"
						status="1 of 4"
						found
						readOnly
						replacing
						onstep={() => {}}
						onclose={() => {}}
						onreplace={() => {}}
						onreplaceall={() => {}}
					/>
				</Specimen>
			</div>
		</section>

		<section class="grid gap-4">
			{@render section('Toolbar, ToggleButton, NumberField')}
			<Specimen name="Toolbar" state="rest">
				<Toolbar label="Formatting" class="border-line bg-surface border-b px-2 py-1">
					<ToolbarGroup>
						<NumberField
							label="Font size"
							hideLabel
							floatNote
							value={16}
							min={8}
							max={72}
							unit="px"
							steppers
							stepLabels={['Smaller', 'Larger']}
							class="w-24"
						/>
					</ToolbarGroup>
					<ToolbarGroup>
						<ToggleButton label="Bold" shortcut="Mod B" icon={Bold} pressed />
						<ToggleButton label="Italic" shortcut="Mod I" icon={Italic} pressed={false} />
						<ToggleButton label="Underline" shortcut="Mod U" icon={Underline} pressed={false} />
					</ToolbarGroup>
					<ToolbarGroup>
						<ToggleButton label="Align left" icon={AlignLeft} pressed />
						<IconButton label="Insert an image" icon={ImagePlus} />
					</ToolbarGroup>
				</Toolbar>
			</Specimen>
			<div class="flex flex-wrap gap-6">
				{#each ['rest', ...FORCED, 'disabled'] as state (state)}
					<Specimen name="ToggleButton" {state}>
						<ToggleButton
							label="Italic"
							icon={Italic}
							pressed={false}
							disabled={state === 'disabled'}
						/>
					</Specimen>
				{/each}
				{#each ['rest', 'hover', 'focus'] as state (state)}
					<Specimen name="ToggleButton pressed" {state}>
						<ToggleButton label="Bold" icon={Bold} pressed />
					</Specimen>
				{/each}
			</div>
			<div class="grid grid-cols-3 gap-6">
				{#each ['rest', ...FORCED] as state (state)}
					<Specimen name="NumberField" {state} target="input">
						<NumberField
							label="Page size"
							value={16}
							min={8}
							max={72}
							unit="px"
							steppers
							stepLabels={['Smaller', 'Larger']}
							hint="Arrow keys step by 1, Shift and an arrow by 10."
						/>
					</Specimen>
				{/each}
				<Specimen name="NumberField no steppers" state="rest" target="input">
					<NumberField label="Word-count target" value={8000} min={0} max={500000} unit="words" />
				</Specimen>
				<Specimen name="NumberField" state="error" target="input">
					<div {@attach typeOutOfRange}>
						<NumberField
							label="Page size"
							value={16}
							min={8}
							max={72}
							unit="px"
							steppers
							noun="a size"
						/>
					</div>
				</Specimen>
				<Specimen name="NumberField" state="disabled" target="input">
					<NumberField label="Page size" value={16} min={8} max={72} unit="px" steppers disabled />
				</Specimen>
			</div>
		</section>

		<section class="grid gap-4">
			{@render section('SplitHandle')}
			<div class="grid grid-cols-2 gap-6">
				{#each ['rest', ...FORCED] as state (state)}
					<Specimen name="SplitHandle" {state}>
						<div class="border-line flex h-24 rounded border">
							<div class="bg-surface-sunken text-small text-ink-muted grow-3 basis-0 p-2">
								Chapter 1
							</div>
							<SplitHandle label="Resize the split" value={0.6} min={0.25} max={0.75} />
							<div class="bg-surface-sunken text-small text-ink-muted grow-2 basis-0 p-2">
								vaswani-2017.pdf
							</div>
						</div>
					</Specimen>
				{/each}
			</div>
		</section>

		<section class="grid gap-4">
			{@render section('Select, DateField')}
			<div class="grid grid-cols-3 gap-6">
				{#each ['rest', ...FORCED, 'disabled'] as state (state)}
					<Specimen name="Select" {state}>
						<Select
							type="single"
							label="Source type"
							items={SOURCE_TYPES}
							value="book"
							disabled={state === 'disabled'}
						/>
					</Specimen>
				{/each}
				<Specimen name="Select" state="open">
					<div data-overlay="select">
						<Select
							type="single"
							label="Source type"
							items={SOURCE_TYPES}
							bind:value={sourceType}
						/>
					</div>
				</Specimen>
				{#each ['rest', 'focus', 'disabled'] as state (state)}
					<Specimen name="DateField" {state} target="[data-segment='month']">
						<DateField label="Published" value={date} disabled={state === 'disabled'} />
					</Specimen>
				{/each}
			</div>
		</section>

		<section class="grid gap-4">
			{@render section('Switch, Checkbox, RadioGroup')}
			<div class="grid grid-cols-3 gap-6">
				{#each ['rest', 'hover', 'focus', 'disabled'] as state (state)}
					<Specimen name="Switch" {state}>
						<Switch
							label="Look up citation details online"
							description="Sends DOIs to Crossref"
							disabled={state === 'disabled'}
						/>
					</Specimen>
				{/each}
				<Specimen name="Switch" state="checked">
					<Switch label="Keep the page on paper" checked />
				</Specimen>
				<Specimen name="Switch" state="checked disabled">
					<Switch label="Keep the page on paper" checked disabled />
				</Specimen>
				{#each ['rest', 'hover', 'focus', 'disabled'] as state (state)}
					<Specimen name="Checkbox" {state}>
						<Checkbox
							label="Include notes"
							description="As footnotes"
							disabled={state === 'disabled'}
						/>
					</Specimen>
				{/each}
				<Specimen name="Checkbox" state="checked">
					<Checkbox label="Include notes" checked />
				</Specimen>
				<Specimen name="Checkbox" state="indeterminate">
					<Checkbox label="All sources" indeterminate />
				</Specimen>
				{#each ['rest', 'focus'] as state (state)}
					<Specimen name="RadioGroup" {state} target="[role='radio']">
						<RadioGroup
							label="Density"
							value="compact"
							options={[
								{ value: 'compact', label: 'Compact', description: 'More on screen' },
								{ value: 'comfortable', label: 'Comfortable' },
								{ value: 'roomy', label: 'Roomy', disabled: true }
							]}
						/>
					</Specimen>
				{/each}
			</div>
		</section>

		<section class="grid gap-4">
			{@render section('SettingRow, RadioCard')}
			<div class="grid grid-cols-2 gap-6">
				<Specimen name="SettingRow" state="rest">
					<div class="grid">
						<SettingRow label="Location" hint="~/Erti/library.db">
							<Button size="sm">Move library…</Button>
						</SettingRow>
						<SettingRow label="Last backup" hint="Today, 09:12 · 7 daily and 4 weekly kept">
							<Button size="sm">Back up now</Button>
						</SettingRow>
					</div>
				</Specimen>
				<Specimen name="SettingRow stacked" state="rest" target="[role='radio']">
					<SettingRow label="Density" hint="How much fits on screen at once." stacked>
						{#snippet children({ labelId, hintId })}
							<RadioCardGroup aria-labelledby={labelId} aria-describedby={hintId} value="compact">
								<RadioCard value="compact" label="Compact" description="Rows like a code editor" />
								<RadioCard
									value="comfortable"
									label="Comfortable"
									description="More room to click"
								/>
							</RadioCardGroup>
						{/snippet}
					</SettingRow>
				</Specimen>
				{#each ['rest', ...FORCED] as state (state)}
					<Specimen name="RadioCard" {state} target="[role='radio'][data-state='unchecked']">
						<RadioCardGroup label="Restore from" value="today" columns={1}>
							<RadioCard value="today" label="Today, 09:12" description="Daily backup" />
							<RadioCard
								value="before"
								label="12 October, 18:40"
								description="Taken before an upgrade"
							/>
						</RadioCardGroup>
					</Specimen>
				{/each}
				<Specimen name="RadioCard" state="disabled">
					<RadioCardGroup label="Restore from" value="today" columns={1} disabled>
						<RadioCard value="today" label="Today, 09:12" description="Daily backup" />
					</RadioCardGroup>
				</Specimen>
			</div>
		</section>

		<!-- Containers -->
		<section class="grid gap-4">
			{@render section('Tabs')}
			<div class="grid grid-cols-2 gap-6">
				{#each ['rest', 'hover', 'focus'] as state (state)}
					<Specimen name="Tabs" {state} target="[role='tab']:nth-child(2)">
						<div class="border-line flex h-40 rounded border">
							<Tabs
								label="Settings sections"
								orientation={state === 'rest' ? 'vertical' : 'horizontal'}
								tabs={[
									{ value: 'appearance', label: 'Appearance' },
									{ value: 'citations', label: 'Citations' },
									{ value: 'privacy', label: 'Privacy', disabled: true }
								]}
							>
								{#snippet panel(value)}
									<p class="text-small text-ink">The {value} section.</p>
								{/snippet}
							</Tabs>
						</div>
					</Specimen>
				{/each}
			</div>
		</section>

		<section class="grid gap-4">
			{@render section('Panel, Sidebar')}
			<div class="grid grid-cols-2 gap-6">
				<Specimen name="Panel" state="rest">
					<div class="border-line flex h-56 rounded border">
						<Panel title="Notes" scope="This project · 12">
							{#snippet action()}
								<Button variant="primary" size="sm">New note</Button>
							{/snippet}
							<Item text="Contradicts the RNN section." quote="the effect was strongest" />
						</Panel>
					</div>
				</Specimen>
				<Specimen name="Sidebar" state="rest">
					<div class="border-line flex h-56 justify-end rounded border">
						<Sidebar title="Source" subtitle="Vaswani et al., 2017" onclose={() => {}}>
							<p class="text-small text-ink p-3">Attention Is All You Need</p>
						</Sidebar>
					</div>
				</Specimen>
				<Specimen name="Sidebar" state="with footer">
					<div class="border-line flex h-56 justify-end rounded border">
						<Sidebar title="Source" subtitle="Vaswani et al., 2017" onclose={() => {}}>
							<p class="text-small text-ink p-3">Attention Is All You Need</p>
							{#snippet footer()}
								<Button variant="ghost">Remove from library…</Button>
								<span class="flex-1"></span>
								<Button variant="primary">Save</Button>
							{/snippet}
						</Sidebar>
					</div>
				</Specimen>
			</div>
		</section>

		<section class="grid gap-4">
			{@render section('Popover, Dialog, ConfirmDialog')}
			<div class="flex flex-wrap gap-6">
				<Specimen name="Popover" state="open">
					<div data-overlay="popover">
						<Popover label="Citation details">
							<p>
								Vaswani et al., 2017, p. 4. <span class="text-ink-muted">From the manuscript.</span>
							</p>
						</Popover>
					</div>
				</Specimen>
				<Specimen name="Dialog" state="open">
					<div data-overlay="dialog">
						<Button onclick={() => (dialogOpen = true)}>Open dialog</Button>
					</div>
					<Dialog
						bind:open={dialogOpen}
						title="Export"
						description="A Word document, with the bibliography"
					>
						<TextField label="File name" value="Chapter 1.docx" />
						{#snippet footer()}
							<Button variant="ghost" onclick={() => (dialogOpen = false)}>Cancel</Button>
							<Button variant="primary">Export</Button>
						{/snippet}
					</Dialog>
				</Specimen>
				<Specimen name="ConfirmDialog" state="open">
					<div data-overlay="confirm">
						<Button variant="danger" onclick={() => (confirmOpen = true)}>Remove…</Button>
					</div>
					<ConfirmDialog
						bind:open={confirmOpen}
						title="Remove this source?"
						action="Remove"
						onConfirm={() => {}}
					>
						{#snippet consequences()}
							<p>Its 3 notes and 2 citations in Chapter 1 go with it.</p>
						{/snippet}
					</ConfirmDialog>
				</Specimen>
			</div>
		</section>

		<!-- Feedback -->
		<section class="grid gap-4">
			{@render section('Banner, EmptyState, ProgressLine, Loader')}
			<div class="grid grid-cols-2 gap-6">
				{#each ['info', 'success', 'warning', 'danger'] as const as tone (tone)}
					<Specimen name="Banner {tone}" state="rest">
						<Banner
							{tone}
							action={tone === 'danger' ? { label: 'Try again', onclick: () => {} } : undefined}
						>
							{tone === 'danger'
								? 'The style could not be loaded.'
								: `A ${tone} message, in words.`}
						</Banner>
					</Specimen>
				{/each}
				<Specimen name="EmptyState" state="rest">
					<EmptyState
						message="No notes yet"
						detail="Highlight a passage in a PDF to start one."
						action={{ label: 'Open a PDF', onclick: () => {} }}
					/>
				</Specimen>
				<Specimen name="ProgressLine" state="rest">
					<ProgressLine label="Matching notes" value={214} max={380} unit="notes" />
				</Specimen>
				<Specimen name="Loader" state="rest">
					<Loader />
				</Specimen>
			</div>
		</section>

		<!-- Navigation -->
		<section class="grid gap-4">
			{@render section('TreeRow, StatusItem')}
			<div class="grid grid-cols-3 gap-6">
				{#each ['rest', ...FORCED] as state (state)}
					<Specimen name="TreeRow" {state}>
						<div role="tree" aria-label="Files {state}" class="bg-surface w-56">
							<TreeRow level={2} label="Literature review" icon={FileText} onselect={() => {}} />
						</div>
					</Specimen>
				{/each}
				<Specimen name="TreeRow branch" state="rest">
					<div role="tree" aria-label="Files branch" class="bg-surface w-56">
						<TreeRow level={1} label="Thesis" icon={Folder} expanded onselect={() => {}} />
						<TreeRow level={1} label="Drafts" icon={Folder} expanded={false} onselect={() => {}} />
					</div>
				</Specimen>
				<Specimen name="TreeRow" state="selected">
					<div role="tree" aria-label="Files selected" class="bg-surface w-56">
						<TreeRow
							level={2}
							label="Chapter 1"
							icon={FileText}
							selected
							meta="open"
							onselect={() => {}}
						/>
					</div>
				</Specimen>
				<Specimen name="TreeRow" state="current">
					<div role="tree" aria-label="Headings current" class="bg-surface w-56">
						<TreeRow
							level={2}
							label="1.2 Attention"
							current
							meta="you're here"
							onselect={() => {}}
						/>
					</div>
				</Specimen>
			</div>
			<Specimen name="StatusItem" state="rest">
				<div
					class="border-line bg-surface text-ink-muted text-caption flex h-(--footer-status-bar-height) items-center gap-4 border-t px-3"
				>
					<StatusItem tone="busy">Processing PDFs: 214/380</StatusItem>
					<StatusItem>4,812 words</StatusItem>
					<StatusItem tone="warning">8,312 words / 8,000, 312 over</StatusItem>
					<StatusItem tone="success">Saved</StatusItem>
					<StatusItem tone="danger">Not saved — retrying</StatusItem>
				</div>
			</Specimen>
		</section>

		<!-- Content -->
		<section class="grid gap-4">
			{@render section('Item, LabelChip, Chip, Kbd')}
			<div class="grid grid-cols-2 gap-6">
				<Specimen name="Item" state="rest" target="button">
					<Item quote={QUOTE} clamp text="Core claim; contrast with the RNN section.">
						{#snippet meta()}
							<LabelChip name="Claim" colour="45 90% 60%" />
							<span>· vaswani-2017.pdf · p. 4</span>
						{/snippet}
						{#snippet actions()}
							<Button variant="ghost" size="sm">Cite</Button>
							<Button variant="ghost" size="sm">Show in PDF</Button>
						{/snippet}
					</Item>
				</Specimen>
				<Specimen name="Item" state="hover" target="button">
					<Item title="Attention Is All You Need" quote={QUOTE} clamp>
						{#snippet leading()}
							<span class="text-caption text-ink font-medium tabular-nums">82%</span>
						{/snippet}
					</Item>
				</Specimen>
				<Specimen name="LabelChip" state="rest">
					<div class="flex gap-3">
						<LabelChip name="Claim" colour="45 90% 60%" />
						<LabelChip name="Method" colour="200 80% 55%" />
						<LabelChip name="Disagree" colour="0 75% 55%" />
					</div>
				</Specimen>
				<Specimen name="Chip" state="rest">
					<div class="flex gap-2">
						<Chip>Book</Chip>
						<Chip tone="accent">Not in this project</Chip>
					</div>
				</Specimen>
				<Specimen name="Kbd" state="rest">
					<Kbd keys="Mod Shift Z" />
				</Specimen>
			</div>
		</section>
	</div>
</main>
