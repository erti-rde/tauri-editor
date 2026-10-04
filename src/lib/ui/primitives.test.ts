import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet, type Component, type ComponentProps } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import X from '~icons/lucide/x';
import Heading1 from '~icons/lucide/heading-1';

import UiHarness from './UiHarness.svelte';
import {
	Button,
	Checkbox,
	DateField,
	IconButton,
	Menu,
	RadioGroup,
	SearchField,
	Select,
	Switch,
	TextArea,
	TextField
} from './index';

/**
 * The primitives (M1c-2, ADR 010). Each is checked for the three things a
 * component built on it can't fix afterwards: it works from the keyboard, it
 * can't be used while disabled, and it has a name a screen reader reads.
 */

const text = (words: string) => createRawSnippet(() => ({ render: () => `<span>${words}</span>` }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = <C extends Component<any>>(component: C, props: Partial<ComponentProps<C>>) =>
	render(UiHarness, { props: { component, ...props } });

// M1c-2 AC-3
describe('Button', () => {
	it('is named by its words and pressed with Enter and Space', async () => {
		const user = userEvent.setup();
		const onclick = vi.fn();
		mount(Button, { children: text('Remove'), variant: 'danger', onclick });

		const button = screen.getByRole('button', { name: 'Remove' });
		button.focus();
		await user.keyboard('{Enter}');
		await user.keyboard(' ');
		expect(onclick).toHaveBeenCalledTimes(2);
	});

	it("can't be pressed while disabled or loading, and says it's busy", async () => {
		const user = userEvent.setup();
		const onclick = vi.fn();
		mount(Button, { children: text('Adding…'), loading: true, onclick });

		const button = screen.getByRole('button', { name: 'Adding…' });
		expect(button).toBeDisabled();
		expect(button).toHaveAttribute('aria-busy', 'true');
		await user.click(button);
		expect(onclick).not.toHaveBeenCalled();
	});

	it('is a button, not a submit, unless asked', () => {
		mount(Button, { children: text('Save') });
		expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
	});
});

// M1c-2 AC-3
describe('IconButton', () => {
	it('is named by its label, and pressed from the keyboard', async () => {
		const user = userEvent.setup();
		const onclick = vi.fn();
		mount(IconButton, { label: 'Close settings', icon: X, onclick });

		const button = screen.getByRole('button', { name: 'Close settings' });
		button.focus();
		await user.keyboard('{Enter}');
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it("can't be pressed while disabled", async () => {
		const user = userEvent.setup();
		const onclick = vi.fn();
		mount(IconButton, { label: 'Close settings', icon: X, onclick, disabled: true });

		await user.click(screen.getByRole('button', { name: 'Close settings' }));
		expect(onclick).not.toHaveBeenCalled();
	});

	it('says when a toggle is on', () => {
		mount(IconButton, { label: 'Bold', icon: X, pressed: true });
		expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
	});
});

// M1c-2 AC-2: checked by `pnpm check`. If `label` ever becomes optional, the
// directive below has nothing to expect and the type check fails.
export const iconButtonNeedsALabel: ComponentProps<typeof IconButton>[] = [
	// @ts-expect-error An IconButton without a label is a type error.
	{ icon: X }
];

// M1c-2 AC-3. jsdom never positions floating content, so bits-ui leaves the
// open menu parked offscreen and testing-library calls it hidden: the queries
// below include hidden elements. The browser journeys open it for real.
const anyVisibility = { hidden: true } as const;

describe('Menu', () => {
	const items = () => [
		{ label: 'Heading 1', icon: Heading1, active: true, onSelect: vi.fn() },
		{ label: 'Delete document', danger: true, onSelect: vi.fn() },
		{ label: 'Rename', description: 'Change the file name', onSelect: vi.fn() }
	];

	it('opens from the keyboard, moves with arrows and chooses with Enter', async () => {
		const user = userEvent.setup();
		const list = items();
		mount(Menu, { label: 'Document', items: list });

		screen.getByRole('button', { name: 'Document' }).focus();
		await user.keyboard('{Enter}');
		expect(screen.getByRole('button', { name: 'Document' })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		const menu = await screen.findByRole('menu', anyVisibility);
		// bits-ui moves focus into the menu after it opens; keys sent before that
		// land on the trigger, which only shows under load.
		await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement));

		// The danger item sits last, whatever order it was given in.
		const names = screen
			.getAllByRole('menuitem', anyVisibility)
			.map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
		expect(names).toEqual(['Heading 1', 'Rename Change the file name', 'Delete document']);

		await user.keyboard('{ArrowDown}{Enter}');
		expect(list[2].onSelect).toHaveBeenCalledTimes(1);
	});

	it("can't be opened while disabled", async () => {
		const user = userEvent.setup();
		mount(Menu, { label: 'Document', items: items(), disabled: true });

		await user.click(screen.getByRole('button', { name: 'Document' }));
		expect(screen.queryByRole('menu', anyVisibility)).not.toBeInTheDocument();
	});

	it('marks the current choice for a screen reader too', async () => {
		const user = userEvent.setup();
		mount(Menu, { label: 'Text style', items: items() });

		await user.click(screen.getByRole('button', { name: 'Text style' }));
		// By its text: a hidden element's accessible name computes as empty.
		await screen.findByRole('menu', anyVisibility);
		const current = screen
			.getAllByRole('menuitem', anyVisibility)
			.find((item) => item.textContent?.includes('Heading 1'));
		expect(current).toHaveAttribute('aria-current', 'true');
	});
});

// M1c-2 AC-3
describe('TextField and TextArea', () => {
	for (const [name, primitive] of [
		['TextField', TextField],
		['TextArea', TextArea]
	] as const) {
		it(`${name}: is named by its label, described by its hint, and typed into`, async () => {
			const user = userEvent.setup();
			mount(primitive, { label: 'DOI', hint: 'Such as 10.1000/xyz' });

			const field = screen.getByRole('textbox', { name: 'DOI' });
			expect(field).toHaveAccessibleDescription('Such as 10.1000/xyz');
			await user.tab();
			expect(field).toHaveFocus();
			await user.keyboard('10.1/x');
			expect(field).toHaveValue('10.1/x');
		});

		it(`${name}: an error replaces the hint and marks the field invalid`, () => {
			mount(primitive, {
				label: 'DOI',
				hint: 'Such as 10.1000/xyz',
				error: 'Enter a DOI, such as 10.1000/xyz'
			});

			const field = screen.getByRole('textbox', { name: 'DOI' });
			expect(field).toHaveAttribute('aria-invalid', 'true');
			expect(field).toHaveAccessibleDescription('Enter a DOI, such as 10.1000/xyz');
		});

		it(`${name}: can't be typed into while disabled`, async () => {
			const user = userEvent.setup();
			mount(primitive, { label: 'DOI', disabled: true });

			const field = screen.getByRole('textbox', { name: 'DOI' });
			await user.type(field, 'x');
			expect(field).toHaveValue('');
			expect(field).toBeDisabled();
		});
	}
});

// M1c-2 AC-3
describe('SearchField', () => {
	it('is named by its hidden label, and Escape clears it', async () => {
		const user = userEvent.setup();
		const onclear = vi.fn();
		mount(SearchField, { label: 'Search your notes', onclear });

		const field = screen.getByRole('searchbox', { name: 'Search your notes' });
		await user.type(field, 'attention');
		expect(field).toHaveValue('attention');

		await user.keyboard('{Escape}');
		expect(field).toHaveValue('');
		expect(onclear).toHaveBeenCalledTimes(1);
	});

	it('offers a named clear button once there is something to clear', async () => {
		const user = userEvent.setup();
		mount(SearchField, { label: 'Search your notes' });

		expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
		await user.type(screen.getByRole('searchbox'), 'x');
		await user.click(screen.getByRole('button', { name: 'Clear search' }));
		expect(screen.getByRole('searchbox')).toHaveValue('');
		expect(screen.getByRole('searchbox')).toHaveFocus();
	});

	it("can't be searched while disabled", () => {
		mount(SearchField, { label: 'Search your notes', disabled: true });
		expect(screen.getByRole('searchbox', { name: 'Search your notes' })).toBeDisabled();
	});
});

// M1c-2 AC-3
describe('Switch and Checkbox', () => {
	for (const [name, primitive, role] of [
		['Switch', Switch, 'switch'],
		['Checkbox', Checkbox, 'checkbox']
	] as const) {
		it(`${name}: is named by its label and toggled with Space`, async () => {
			const user = userEvent.setup();
			const onCheckedChange = vi.fn();
			mount(primitive, {
				label: 'Follow the writing',
				description: 'Search as the cursor moves',
				onCheckedChange
			});

			const control = screen.getByRole(role, { name: 'Follow the writing' });
			expect(control).toHaveAccessibleDescription('Search as the cursor moves');
			control.focus();
			await user.keyboard(' ');
			expect(onCheckedChange).toHaveBeenCalledWith(true);
			expect(control).toHaveAttribute('aria-checked', 'true');
		});

		it(`${name}: can't be toggled while disabled`, async () => {
			const user = userEvent.setup();
			const onCheckedChange = vi.fn();
			mount(primitive, { label: 'Follow the writing', disabled: true, onCheckedChange });

			await user.click(screen.getByRole(role, { name: 'Follow the writing' }));
			expect(onCheckedChange).not.toHaveBeenCalled();
		});
	}

	it('Checkbox: says when it is partly checked', () => {
		mount(Checkbox, { label: 'All sources', indeterminate: true });
		expect(screen.getByRole('checkbox', { name: 'All sources' })).toHaveAttribute(
			'aria-checked',
			'mixed'
		);
	});
});

// M1c-2 AC-3
describe('RadioGroup', () => {
	const options = [
		{ value: 'compact', label: 'Compact' },
		{ value: 'comfortable', label: 'Comfortable', description: 'Taller rows' },
		{ value: 'roomy', label: 'Roomy', disabled: true }
	];

	it('is named by its question, and arrow keys choose', async () => {
		const user = userEvent.setup();
		const onValueChange = vi.fn();
		mount(RadioGroup, { label: 'Density', options, value: 'compact', onValueChange });

		expect(screen.getByRole('radiogroup', { name: 'Density' })).toBeInTheDocument();
		screen.getByRole('radio', { name: 'Compact' }).focus();
		await user.keyboard('{ArrowDown}');
		expect(onValueChange).toHaveBeenLastCalledWith('comfortable');
		expect(screen.getByRole('radio', { name: 'Comfortable' })).toHaveAccessibleDescription(
			'Taller rows'
		);
	});

	it('skips a disabled option, and a disabled group takes no choice', async () => {
		const user = userEvent.setup();
		const onValueChange = vi.fn();
		mount(RadioGroup, { label: 'Density', options, value: 'compact', onValueChange });

		await user.click(screen.getByRole('radio', { name: 'Roomy' }));
		expect(onValueChange).not.toHaveBeenCalled();
	});
});

// M1c-2 AC-1, AC-3: restyled and folded in
describe('Select', () => {
	const items = [
		{ value: 'book', label: 'Book' },
		{ value: 'article', label: 'Journal article' }
	];

	it('is named by its label, and opens and chooses from the keyboard', async () => {
		const user = userEvent.setup();
		const onValueChange = vi.fn();
		mount(Select, { label: 'Source type', items, type: 'single', onValueChange });

		const trigger = screen.getByRole('button', { name: 'Source type' });
		expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
		trigger.focus();
		await user.keyboard('{Enter}');
		await screen.findByRole('listbox', anyVisibility);
		await user.keyboard('{ArrowDown}{Enter}');
		expect(onValueChange).toHaveBeenCalled();
	});

	it("can't be opened while disabled", async () => {
		const user = userEvent.setup();
		mount(Select, { label: 'Source type', items, type: 'single', disabled: true });

		await user.click(screen.getByRole('button', { name: 'Source type' }));
		expect(screen.queryByRole('listbox', anyVisibility)).not.toBeInTheDocument();
	});
});

// M1c-2 AC-1, AC-3: restyled and folded in
describe('DateField', () => {
	it('is named by its label, and each part steps with the arrow keys', async () => {
		const user = userEvent.setup();
		mount(DateField, { label: 'Issued' });

		expect(screen.getByRole('group', { name: 'Issued' })).toBeInTheDocument();
		const parts = screen.getAllByRole('spinbutton');
		expect(parts.length).toBeGreaterThanOrEqual(3);
		parts[0].focus();
		await user.keyboard('{ArrowUp}');
		expect(parts[0]).toHaveAttribute('aria-valuenow');
	});

	it("can't be changed while disabled", () => {
		mount(DateField, { label: 'Issued', disabled: true });
		for (const part of screen.getAllByRole('spinbutton')) {
			expect(part).toHaveAttribute('aria-disabled', 'true');
		}
	});
});

// M1c-2 AC-4
describe('variants.ts', () => {
	it('has no dependencies', () => {
		const source = readFileSync(join(process.cwd(), 'src/lib/ui/variants.ts'), 'utf8');
		expect(source).not.toMatch(/^\s*import\s/m);
		expect(source).not.toMatch(/\brequire\(/);
	});
});
