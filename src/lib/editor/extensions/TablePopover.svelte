<script lang="ts">
	import { type Editor } from '@tiptap/core';

	import type { Snippet } from 'svelte';

	import { Popover, Separator } from 'bits-ui';

  import TableColumnAddAfter from '~icons/mdi/table-column-plus-after';
  import TableColumnAddBefore from '~icons/mdi/table-column-plus-before';
  import TableColumnRemove from '~icons/mdi/table-column-remove';
  import TableRowAddAfter from '~icons/mdi/table-row-plus-after';
  import TableRowAddBefore from '~icons/mdi/table-row-plus-before';
  import TableRowRemove from '~icons/mdi/table-row-remove';
  import TableMergeCells from '~icons/mdi/table-merge-cells';
  import TableSplitCell from '~icons/mdi/table-split-cell';
  import TableHeaderEye from '~icons/mdi/table-headers-eye';
  // import TableHeaderRow from '~icons/mdi/table-header-row';
  // import TableHeaderColumn from '~icons/mdi/table-header-column';
  // import TableHeadersEye from '~icons/mdi/table-headers-eye';
  import TableRemove from '~icons/mdi/table-remove';
  import TableSync from '~icons/mdi/table-sync';

	interface Props {
		editor: Editor;
		children: Snippet;
	}

	let { children, editor }: Props = $props();

	let isActive = $derived.by<boolean>(() => editor.isActive('table'));
	let customAnchor = $derived.by(() => getCurrentTableElement());

	function getCurrentTableElement() {
		if (!editor || !editor.isActive('table')) return null;

		const { selection } = editor.state;
		const domInfo = editor.view.domAtPos(selection.from);
		const node = domInfo.node;
		if (!node || !(node instanceof Element) || !node.closest('table')) return null;
		let element = node.closest('.tableWrapper');

		return element;
	}


  const tableFunctions = [
    {
      icon: TableColumnAddAfter,
      action: () => editor.chain().focus().addColumnAfter().run(),
      label: 'Add Column After'
    },
    {
      icon: TableColumnAddBefore,
      action: () => editor.chain().focus().addColumnBefore().run(),
      label: 'Add Column Before'
    },
    {
      icon: TableColumnRemove,
      action: () => editor.chain().focus().deleteColumn().run(),
      label: 'Delete Column'
    },
    {
      icon: TableRowAddAfter,
      action: () => editor.chain().focus().addRowAfter().run(),
      label: 'Add Row After'
    },
    {
      icon: TableRowAddBefore,
      action: () => editor.chain().focus().addRowBefore().run(),
      label: 'Add Row Before'
    },
    {
      icon: TableRowRemove,
      action: () => editor.chain().focus().deleteRow().run(),
      label: 'Delete Row'
    },
    {
      icon: TableMergeCells,
      action: () => editor.chain().focus().mergeCells().run(),
      label: 'Merge Cells'
    },
    {
      icon: TableSplitCell,
      action: () => editor.chain().focus().splitCell().run(),
      label: 'Split Cell'
    },
    {
      icon: TableHeaderEye,
      action: () => editor.chain().focus().toggleHeaderCell().run(),
      label: 'Toggle Header Cell'
    },
    // {
    //   icon: TableHeaderRow,
    //   action: () => editor.chain().focus().toggleHeaderRow().run(),
    //   label: 'Toggle Header Row'
    // },
    // {
    //   icon: TableHeaderColumn,
    //   action: () => editor.chain().focus().toggleHeaderColumn().run(),
    //   label: 'Toggle Header Column'
    // },
    // {
    //   icon: TableHeadersEye,
    //   action: () => editor.chain().focus().toggleAllHeadersVisibility().run(),
    //   label: 'Toggle All Headers Visibility'
    // },
    {
      icon: TableRemove,
      action: () => editor.chain().focus().deleteTable().run(),
      label: 'Delete Table'
    },
    {
      icon: TableSync,
      action: () => editor.chain().focus().fixTables().run(),
      label: 'Fix Tables'
    }
  ]

  
</script>

<Popover.Root bind:open={isActive}>
	<Popover.Trigger>
		{@render children()}
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			{customAnchor}
			side="top"
			align="end"
			avoidCollisions={false}
			escapeKeydownBehavior="ignore"
			interactOutsideBehavior="ignore"
			trapFocus={false}
			class="shadow-popover data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 w-full origin-(--bits-popover-content-transform-origin) rounded-[12px] border border-orange-200 bg-orange-50 p-2"
			sideOffset={8}
		>
			<div class="flex items-center">
        {#each tableFunctions as { icon: Icon, action, label }} 
        <button
          onclick={action}
          class="flex items-center space-x-2 rounded-md p-2 text-sm text-gray-700 hover:bg-orange-100"
        >
          <Icon class="h-4 w-4" />
        </button>
        {/each}
      </div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
