import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet, type Component, type ComponentProps } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import UiHarness from './UiHarness.svelte';
import {
	Banner,
	ConfirmDialog,
	Dialog,
	EmptyState,
	Panel,
	Popover,
	ProgressLine,
	Sidebar,
	Tabs
} from './index';

/** Containers and feedback (M1c-3, ADR 010). */

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }));
const panelFor = createRawSnippet((tab: () => string) => ({
	render: () => `<p>The ${tab()} panel</p>`
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = <C extends Component<any>>(component: C, props: Partial<ComponentProps<C>>) =>
	render(UiHarness, { props: { component, ...props } });

// M1c-3 AC-2
describe('Dialog', () => {
	it('is named and described, takes focus, and gives it back on Escape', async () => {
		const user = userEvent.setup();
		const opener = document.createElement('button');
		opener.textContent = 'Open';
		document.body.append(opener);
		opener.focus();

		const onOpenChange = vi.fn();
		mount(Dialog, {
			open: true,
			onOpenChange,
			title: 'Settings',
			description: 'For this machine',
			closeLabel: 'Close settings',
			children: html('<div><button>First</button><button>Last</button></div>')
		});

		const dialog = await screen.findByRole('dialog', { name: 'Settings' });
		expect(dialog).toHaveAccessibleDescription('For this machine');
		await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

		// Tab staying inside is proven in Chromium ("Settings keeps focus…" in
		// e2e/journeys.spec.ts): the trap measures what's tabbable, and jsdom has
		// no layout to measure.

		await user.keyboard('{Escape}');
		expect(onOpenChange).toHaveBeenCalledWith(false);
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		await waitFor(() => expect(opener).toHaveFocus());
		opener.remove();
	});

	it('closes from its named close button', async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		mount(Dialog, {
			open: true,
			onOpenChange,
			title: 'Settings',
			closeLabel: 'Close settings',
			children: html('<p>Body</p>')
		});

		await user.click(await screen.findByRole('button', { name: 'Close settings' }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});

// M1c-3 AC-2
describe('ConfirmDialog', () => {
	const consequences = html(
		'<p>14 citations in 3 chapters will show the copy the manuscripts carry.</p>'
	);

	it('says what it touches, and its danger button says the verb', async () => {
		const user = userEvent.setup();
		const onConfirm = vi.fn();
		mount(ConfirmDialog, {
			open: true,
			title: 'Remove Orality and Literacy?',
			action: 'Remove',
			consequences,
			onConfirm
		});

		const dialog = await screen.findByRole('dialog', { name: 'Remove Orality and Literacy?' });
		expect(dialog).toHaveTextContent('14 citations in 3 chapters');
		await user.click(screen.getByRole('button', { name: 'Remove' }));
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it('Cancel closes it without acting', async () => {
		const user = userEvent.setup();
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();
		mount(ConfirmDialog, {
			open: true,
			title: 'Remove it?',
			action: 'Remove',
			consequences,
			onConfirm,
			onOpenChange
		});

		await user.click(await screen.findByRole('button', { name: 'Cancel' }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('while busy, neither button can be pressed again', async () => {
		mount(ConfirmDialog, {
			open: true,
			title: 'Remove it?',
			action: 'Remove',
			consequences,
			onConfirm: vi.fn(),
			busy: true
		});

		expect(await screen.findByRole('button', { name: 'Remove' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
	});
});

// M1c-3 AC-2: checked by `pnpm check`. Were either prop optional, its
// directive would have nothing to expect, and the type check would fail.
export const confirmNeedsAVerbAndConsequences: ComponentProps<typeof ConfirmDialog>[] = [
	// @ts-expect-error A ConfirmDialog without its verb is a type error.
	{ title: 'Remove it?', consequences: html('<p>x</p>'), onConfirm: () => {} },
	// @ts-expect-error A ConfirmDialog without its consequences is a type error.
	{ title: 'Remove it?', action: 'Remove', onConfirm: () => {} }
];

// M1c-3 AC-1
describe('Popover', () => {
	it('opens from its named trigger with the keyboard, and Escape closes it', async () => {
		const user = userEvent.setup();
		mount(Popover, { label: 'Page layout', children: html('<p>Spreads</p>') });

		const trigger = screen.getByRole('button', { name: 'Page layout' });
		trigger.focus();
		await user.keyboard('{Enter}');
		expect(trigger).toHaveAttribute('aria-expanded', 'true');
		expect(await screen.findByText('Spreads')).toBeInTheDocument();

		await user.keyboard('{Escape}');
		await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
	});

	it("can't be opened while disabled", async () => {
		const user = userEvent.setup();
		mount(Popover, { label: 'Page layout', disabled: true, children: html('<p>Spreads</p>') });

		await user.click(screen.getByRole('button', { name: 'Page layout' }));
		expect(screen.queryByText('Spreads')).not.toBeInTheDocument();
	});
});

// M1c-3 AC-1
describe('Tabs', () => {
	const tabs = [
		{ value: 'file', label: 'File' },
		{ value: 'notes', label: 'Notes' },
		{ value: 'cited', label: 'Cited in', disabled: true }
	];

	it('names its list, moves with the arrow keys and shows one panel', async () => {
		const user = userEvent.setup();
		mount(Tabs, { label: 'Source sections', tabs, panel: panelFor });

		expect(screen.getByRole('tablist', { name: 'Source sections' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'File' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tabpanel')).toHaveTextContent('The file panel');

		screen.getByRole('tab', { name: 'File' }).focus();
		await user.keyboard('{ArrowRight}');
		await user.keyboard('{Enter}');
		expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tabpanel')).toHaveTextContent('The notes panel');
	});

	it("a disabled tab can't be chosen", async () => {
		const user = userEvent.setup();
		mount(Tabs, { label: 'Source sections', tabs, panel: panelFor });

		await user.click(screen.getByRole('tab', { name: 'Cited in' }));
		expect(screen.getByRole('tab', { name: 'Cited in' })).toHaveAttribute('aria-selected', 'false');
	});
});

// M1c-3 AC-1
describe('Panel', () => {
	it('is a region named by its title, with its scope and one action', () => {
		mount(Panel, {
			title: 'Notes',
			scope: 'This project · 42 notes',
			action: html('<button>New note</button>'),
			children: html('<ul><li>A note</li></ul>')
		});

		const region = screen.getByRole('region', { name: 'Notes' });
		expect(region).toHaveTextContent('This project · 42 notes');
		expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'New note' })).toBeInTheDocument();
	});
});

// M1c-3 AC-1
describe('Sidebar', () => {
	it('is named by its title, and Escape or its close button closes it', async () => {
		const user = userEvent.setup();
		const onclose = vi.fn();
		mount(Sidebar, {
			title: 'Orality and Literacy',
			subtitle: 'Book · Ong, W. J. · 1982',
			onclose,
			children: html('<button>Edit details</button>')
		});

		expect(screen.getByRole('complementary', { name: 'Orality and Literacy' })).toHaveTextContent(
			'Book · Ong, W. J. · 1982'
		);
		screen.getByRole('button', { name: 'Edit details' }).focus();
		await user.keyboard('{Escape}');
		await user.click(screen.getByRole('button', { name: 'Close Orality and Literacy' }));
		expect(onclose).toHaveBeenCalledTimes(2);
	});
});

// M1c-3 AC-1
describe('Banner', () => {
	it('says its tone in words and an icon, alerts only for danger, and offers one action', async () => {
		const user = userEvent.setup();
		const onclick = vi.fn();
		mount(Banner, {
			tone: 'danger',
			action: { label: 'Choose another style', onclick },
			children: html('<span>The style could not be loaded.</span>')
		});

		expect(screen.getByRole('alert')).toHaveTextContent('The style could not be loaded.');
		expect(screen.getByRole('alert').querySelector('svg')).not.toBeNull();
		await user.click(screen.getByRole('button', { name: 'Choose another style' }));
		expect(onclick).toHaveBeenCalled();
	});

	it('is a status, not an alert, for anything short of danger', () => {
		mount(Banner, { tone: 'warning', children: html('<span>Saved by a newer Erti.</span>') });
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent('Saved by a newer Erti.');
	});
});

// M1c-3 AC-1
describe('EmptyState', () => {
	it('says which kind of nothing, and what to do', async () => {
		const user = userEvent.setup();
		const onclick = vi.fn();
		mount(EmptyState, {
			message: 'No notes match “attention”.',
			detail: 'Try fewer words, or search by meaning.',
			action: { label: 'Clear the search', onclick }
		});

		expect(screen.getByText('No notes match “attention”.')).toBeInTheDocument();
		expect(screen.getByText('Try fewer words, or search by meaning.')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Clear the search' }));
		expect(onclick).toHaveBeenCalled();
		// Not a live region: an empty panel isn't announced on opening.
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});
});

// M1c-3 AC-1
describe('ProgressLine', () => {
	it('is a named progress bar that reads as a count', () => {
		mount(ProgressLine, { label: 'Embedding notes', value: 214, max: 380, unit: 'notes' });

		const bar = screen.getByRole('progressbar', { name: 'Embedding notes' });
		expect(bar).toHaveAttribute('aria-valuenow', '214');
		expect(bar).toHaveAttribute('aria-valuemax', '380');
		expect(bar).toHaveAttribute('aria-valuetext', '214 of 380 notes');
		expect(screen.getByText('214 of 380 notes')).toBeInTheDocument();
	});

	it('never reads past the end', () => {
		mount(ProgressLine, { label: 'Embedding notes', value: 400, max: 380 });
		expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '380');
	});
});

// M1c-3 AC-1: aligned to tokens
describe('Loader', () => {
	it('draws in the palette, not in fixed colours', () => {
		const source = readFileSync(join(process.cwd(), 'src/lib/loader/Loader.svelte'), 'utf8');
		expect(source).not.toMatch(/--color-[a-z]+-\d+/);
		expect(source).toMatch(/hsl\(var\(--accent\)\)/);
	});
});
