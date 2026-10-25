import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import type { ComponentProps } from 'svelte';

import TreeItem from './TreeItem.svelte';
import { workspaceStore } from '$lib/workspace/workspaceStore';

vi.mock('$lib/stores/fileSystem.svelte', () => ({
	fileSystemState: {
		currentFile: null
	}
}));

describe('TreeItem Component', () => {
	const paper = {
		name: 'vaswani-2017.pdf',
		path: '/thesis/papers/vaswani-2017.pdf',
		is_dir: false,
		children: []
	};

	const folder = {
		name: 'papers',
		path: '/thesis/papers',
		is_dir: true,
		children: [paper]
	};

	const tree = (props: ComponentProps<typeof TreeItem>) => render(TreeItem, { props });

	beforeEach(() => {
		vi.clearAllMocks();
		workspaceStore.reset();
	});

	afterEach(() => {
		cleanup();
	});

	it('is a row of the tree, named by the file', () => {
		tree({ item: paper });
		expect(screen.getByRole('treeitem', { name: /^vaswani-2017\.pdf/ })).toBeInTheDocument();
	});

	it('M6-8 AC-1: opens and closes a folder on a click', async () => {
		const user = userEvent.setup();
		tree({ item: folder });
		const row = screen.getByRole('treeitem', { name: /^papers/ });

		expect(row).toHaveAttribute('aria-expanded', 'false');
		expect(screen.queryByRole('treeitem', { name: /^vaswani/ })).not.toBeInTheDocument();

		await user.click(row);
		expect(row).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByRole('treeitem', { name: /^vaswani/ })).toHaveAttribute('aria-level', '2');
	});

	it('M6-8 AC-1: opens a paper in a tab, and then says it is open', async () => {
		const user = userEvent.setup();
		tree({ item: paper });
		const row = screen.getByRole('treeitem', { name: /^vaswani/ });

		expect(row).toHaveAttribute('aria-selected', 'false');
		await user.click(row);

		expect(get(workspaceStore).tabs[paper.path]).toMatchObject({
			kind: 'pdf',
			title: 'vaswani-2017'
		});
		expect(row).toHaveAttribute('aria-selected', 'true');
		expect(row).toHaveTextContent('open');
	});

	it('indents by its depth', () => {
		tree({ item: paper, depth: 2 });
		expect(screen.getByRole('treeitem')).toHaveAttribute('aria-level', '3');
	});
});
