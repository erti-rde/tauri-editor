import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet, type Component, type ComponentProps } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import UiHarness from './UiHarness.svelte';
import { Chip, Item, Kbd, LabelChip } from './index';
import { PALETTES } from '$lib/theme/theme';
import ResultCard from '$lib/editor/extensions/citation/ResultCard.svelte';

vi.mock('$lib/pdfreader/showInPdf', () => ({ showInPdf: vi.fn(async () => true) }));

/** Content pieces (M1c-4, ADR 010). */

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = <C extends Component<any>>(component: C, props: Partial<ComponentProps<C>>) =>
	render(UiHarness, { props: { component, ...props } });

afterEach(() => document.documentElement.removeAttribute('data-theme'));

const LONG =
	'Self-attention relates every position of a sequence to every other position in a single step, and multi-head attention runs several of these in parallel.';

// M1c-4 AC-1
describe('Item', () => {
	it('shows the meta line, the text, the quote and the actions, in that order', () => {
		mount(Item, {
			meta: html('<span>Claim · vaswani-2017.pdf · p. 4</span>'),
			text: 'Contradicts the RNN section.',
			quote: 'the effect was strongest',
			actions: html('<button>Cite</button>')
		});

		const parts = ['Claim · vaswani-2017.pdf · p. 4', 'Contradicts', 'the effect was', 'Cite'].map(
			(words) => screen.getByText(new RegExp(words))
		);
		for (let i = 1; i < parts.length; i++) {
			expect(parts[i - 1].compareDocumentPosition(parts[i])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		}
	});

	it('shortens a long quote, and More and Less are buttons that say which', async () => {
		const user = userEvent.setup();
		mount(Item, { quote: LONG, clamp: true });

		const more = screen.getByRole('button', { name: 'Show more' });
		expect(more).toHaveAttribute('aria-expanded', 'false');
		// Tied to the passage it shortens, not only placed beside it.
		expect(document.getElementById(more.getAttribute('aria-controls')!)).toHaveTextContent(LONG);
		more.focus();
		await user.keyboard('{Enter}');
		expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
	});

	it('leaves a short quote alone', () => {
		mount(Item, { quote: 'the effect was strongest', clamp: true });
		expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
	});
});

// M1c-4 AC-3
describe('LabelChip', () => {
	for (const palette of PALETTES) {
		it(`names the label, not just its colour, in ${palette.label}`, () => {
			document.documentElement.setAttribute('data-theme', palette.id);
			mount(LabelChip, { name: 'Claim', colour: '45 90% 60%' });

			const name = screen.getByText('Claim');
			expect(name).toBeVisible();
			// The dot is decoration: the name is what's read.
			const dot = name.previousElementSibling;
			expect(dot).toHaveAttribute('aria-hidden', 'true');
		});
	}
});

// M1c-4 AC-1
describe('Chip and Kbd', () => {
	it('Chip shows its words', () => {
		mount(Chip, { children: html('<span>Book</span>') });
		expect(screen.getByText('Book')).toBeInTheDocument();
	});

	it('Kbd is a kbd element holding the keys', () => {
		mount(Kbd, { keys: 'Mod Shift Z' });
		const kbd = screen.getByText('Mod Shift Z');
		expect(kbd.tagName).toBe('KBD');
	});
});

// M1c-4 AC-2
describe('the lists that render through Item', () => {
	for (const file of [
		'src/lib/notes/Notes.svelte',
		'src/lib/editor/extensions/citation/ResultCard.svelte'
	]) {
		it(`${file} draws its rows with Item`, () => {
			const source = readFileSync(join(process.cwd(), file), 'utf8');
			expect(source).toMatch(/import \{[^}]*\bItem\b[^}]*\} from '\$lib\/ui'/);
			expect(source).toMatch(/<Item\b/);
		});
	}

	it('a citation result keeps its names: the cite button, Show in PDF and More', async () => {
		const user = userEvent.setup();
		const oncite = vi.fn();
		mount(ResultCard, {
			sentenceMetadata: {
				sha256: 'a'.repeat(64),
				similarity: 0.82,
				sentence: LONG,
				metadata: { id: 'x', type: 'article-journal', title: 'Attention Is All You Need' },
				page_start: 4,
				section: 'Introduction',
				in_project: true
			},
			oncite
		});

		expect(screen.getByText('Attention Is All You Need')).toBeInTheDocument();
		expect(screen.getByText('82%')).toBeInTheDocument();
		expect(screen.getByText('p. 4')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: /^Cite$/ }));
		expect(oncite).toHaveBeenCalled();
		expect(screen.getByRole('button', { name: /Show in PDF/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
	});

	it('a result from outside the project offers to add it, and says it is adding', () => {
		mount(ResultCard, {
			sentenceMetadata: {
				sha256: 'a'.repeat(64),
				similarity: 0.5,
				sentence: 'short',
				metadata: { id: 'x', type: 'book', title: 'Elsewhere' },
				in_project: false
			},
			oncite: vi.fn(),
			busy: true
		});

		const button = screen.getByRole('button', { name: /Adding…/ });
		expect(button).toBeDisabled();
		expect(button).toHaveAttribute('aria-busy', 'true');
	});

	it('draws no meta line for a passage with no page or section', () => {
		const view = mount(ResultCard, {
			sentenceMetadata: {
				sha256: 'a'.repeat(64),
				similarity: 0.5,
				sentence: 'short',
				metadata: { id: 'x', type: 'book', title: 'Elsewhere' },
				in_project: true
			},
			oncite: vi.fn()
		});
		expect(view.container.querySelector('.text-caption.text-ink-muted.flex')).toBeNull();
	});

	it('names a section with no page without a stray separator', () => {
		mount(ResultCard, {
			sentenceMetadata: {
				sha256: 'a'.repeat(64),
				similarity: 0.5,
				sentence: 'short',
				metadata: { id: 'x', type: 'book', title: 'Elsewhere' },
				section: 'Results',
				in_project: true
			},
			oncite: vi.fn()
		});
		expect(screen.getByText('Results').textContent?.trim()).toBe('Results');
	});
});
