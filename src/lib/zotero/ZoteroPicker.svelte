<script lang="ts">
	import { open as pickFolder } from '@tauri-apps/plugin-dialog';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import FileText from '~icons/lucide/file-text';
	import Folder from '~icons/lucide/folder';
	import Inbox from '~icons/lucide/inbox';
	import Library from '~icons/lucide/library';

	import { call, commands, describeError, type ZoteroPick } from '$lib/ipc';
	import { Banner, Button, EmptyState, Loader, TreeRow } from '$lib/ui';

	import {
		libraryId,
		picksOf,
		stateOf,
		toggle,
		treeOf,
		withPapers,
		type TreeNode
	} from './selection';

	/**
	 * The Zotero library as Zotero draws it, to tick from (M1b-11, docs/ux.md
	 * UX-13): My Library and each group, collections nested, a collection's
	 * papers loaded as it opens. Erti finds Zotero itself, or is shown where it
	 * is; nothing in Zotero is changed.
	 */
	interface Props {
		/** What's ticked, as Rust reads and a project follows it. */
		picks?: ZoteroPick[];
		disabled?: boolean;
	}

	let { picks = $bindable([]), disabled = false }: Props = $props();

	let phase = $state<'looking' | 'none' | 'ready' | 'failed'>('looking');
	let failure = $state<string | null>(null);
	let readingFrom = $state<string | null>(null);
	let tree = $state.raw(new Map<string, TreeNode>());
	let ticked = $state.raw(new Set<string>());
	const expanded = new SvelteSet<string>();
	const loading = new SvelteSet<string>();

	onMount(load);

	async function load() {
		phase = 'looking';
		failure = null;
		try {
			let status = await call(commands.zoteroStatus());
			// Found where Zotero keeps it by default: choosing "From Zotero" is
			// the say-so to read it.
			if (!status.linked && status.detected) status = await call(commands.zoteroLink(null));
			if (!status.linked) {
				phase = 'none';
				return;
			}
			readingFrom = status.linked;
			const libraries = await call(commands.zoteroTree());
			tree = treeOf(libraries);
			ticked = new Set();
			expanded.clear();
			for (const library of libraries) expanded.add(libraryId(library.id));
			phase = 'ready';
		} catch (error) {
			failure = describeError(error);
			phase = 'failed';
		}
	}

	async function locate() {
		const folder = await pickFolder({
			title: 'Choose Zotero’s data folder',
			directory: true,
			multiple: false
		});
		if (typeof folder !== 'string') return;
		try {
			await call(commands.zoteroLink(folder));
		} catch (error) {
			failure = describeError(error);
			if (phase !== 'ready') phase = 'failed';
			return;
		}
		await load();
	}

	$effect(() => {
		picks = picksOf(tree, ticked);
	});

	const branch = (node: TreeNode) => node.kind !== 'item';

	/** Open a branch, loading its papers first, so what's shown under it is all of it. */
	async function openOrClose(node: TreeNode) {
		if (expanded.has(node.id)) {
			expanded.delete(node.id);
			return;
		}
		if (!node.complete) {
			loading.add(node.id);
			try {
				const papers = await call(
					commands.zoteroItems(node.library, node.kind === 'collection' ? node.key : null)
				);
				({ tree, ticked } = withPapers(tree, ticked, node.id, papers));
			} catch (error) {
				failure = describeError(error);
				return;
			} finally {
				loading.delete(node.id);
			}
		}
		expanded.add(node.id);
	}

	function tick(node: TreeNode) {
		if (disabled) return;
		ticked = toggle(tree, ticked, node.id);
	}

	/** The rows on screen, in order, each with its depth. */
	const rows = $derived.by(() => {
		const out: { node: TreeNode; level: number }[] = [];
		const walk = (id: string, level: number) => {
			const node = tree.get(id);
			if (!node) return;
			out.push({ node, level });
			if (expanded.has(id)) for (const child of node.children) walk(child, level + 1);
		};
		for (const node of tree.values()) if (node.parent === null) walk(node.id, 1);
		return out;
	});

	const count = (n: number) => n.toLocaleString('en-GB');

	/** A short fact on the right, in words. */
	function meta(node: TreeNode): string {
		if (loading.has(node.id)) return 'loading…';
		if (node.paper) {
			const { creators, year, pdfs } = node.paper;
			return [creators, year, pdfs === 0 ? 'no PDF' : ''].filter(Boolean).join(' · ');
		}
		return count(node.papers);
	}

	const icons = { library: Library, collection: Folder, unfiled: Inbox, item: FileText };
</script>

{#if phase === 'looking'}
	<div class="flex justify-center"><Loader /></div>
{:else if phase === 'none'}
	<EmptyState
		message="Erti didn’t find Zotero on this computer."
		detail="If Zotero keeps its library somewhere else, show Erti the folder. Zotero names it under Settings › Advanced › Files and Folders."
		action={{ label: 'Locate Zotero data folder…', onclick: locate }}
	/>
	{#if failure}<Banner tone="warning">{failure}</Banner>{/if}
{:else if phase === 'failed'}
	<Banner tone="warning" action={{ label: 'Try again', onclick: load }}>{failure}</Banner>
	<div><Button variant="ghost" size="sm" onclick={locate}>Locate Zotero data folder…</Button></div>
{:else}
	<div class="grid gap-2">
		{#if failure}<Banner tone="warning">{failure}</Banner>{/if}
		{#if tree.size === 0}
			<EmptyState message="Your Zotero library is empty." />
		{:else}
			<div
				role="tree"
				aria-label="Zotero library"
				aria-multiselectable="true"
				class="border-line bg-surface max-h-72 overflow-y-auto rounded border"
				data-testid="zotero-tree"
			>
				{#each rows as { node, level }, i (node.id)}
					<TreeRow
						{level}
						label={node.name}
						icon={icons[node.kind]}
						expanded={branch(node) && (node.children.length > 0 || !node.complete)
							? expanded.has(node.id)
							: undefined}
						tabbable={i === 0}
						meta={meta(node)}
						checked={stateOf(tree, ticked, node.id)}
						oncheck={() => tick(node)}
						onselect={() => (branch(node) ? openOrClose(node) : tick(node))}
						ontoggle={() => openOrClose(node)}
					/>
				{/each}
			</div>
		{/if}
		<p class="text-caption text-ink-muted">
			From Zotero’s library in <span class="font-mono">{readingFrom}</span>. Erti reads it and
			changes nothing there.
			<Button variant="ghost" size="sm" onclick={locate}>Use another folder…</Button>
		</p>
	</div>
{/if}
