import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import type { SuggestionOptions } from '@tiptap/suggestion';

import type { CitationItem } from '$lib/stores/citationStore';

/**
 * The citation picker: the `@` list in the manuscript, and the list a
 * citation opens to be edited. On the `Combobox` primitive since M6-8.
 */

const sources: Record<string, CitationItem> = {
	vaswani: {
		id: 'vaswani',
		type: 'article-journal',
		title: 'Attention Is All You Need',
		author: [
			{ family: 'Vaswani', given: 'Ashish' },
			{ family: 'Shazeer', given: 'Noam' },
			{ family: 'Parmar', given: 'Niki' }
		],
		issued: { 'date-parts': [[2017]] }
	},
	nameless: { id: 'nameless', type: 'report', title: 'Minutes of a meeting' },
	who: {
		id: 'who',
		type: 'report',
		title: 'World health statistics',
		author: [{ literal: 'World Health Organization' } as never],
		issued: { 'date-parts': [[2023]] }
	}
};

vi.mock('$lib/stores/citationStore', () => ({
	citationStore: { getAllSourcesAsJson: () => sources }
}));

const { default: CitationSuggestion } = await import('./CitationSuggestion.svelte');
const { suggestion } = await import('./Suggestion.svelte');

const items = Object.values(sources);

function open(props: { initialSelection?: string[]; query?: string; items?: CitationItem[] } = {}) {
	const cl = vi.fn();
	const owner = document.createElement('div');
	document.body.append(owner);
	const view = render(CitationSuggestion, { props: { items, cl, owner, ...props } });
	const press = (key: string) => {
		const event = new KeyboardEvent('keydown', { key, cancelable: true });
		const handled = (
			view.component as { onKeyDown: (p: { event: KeyboardEvent }) => boolean }
		).onKeyDown({ event });
		return { handled, prevented: event.defaultPrevented };
	};
	return { cl, owner, press };
}

describe('the citation picker', () => {
	it('M6-8 AC-1: is a named list of sources, each with who and when', () => {
		const { owner } = open();

		const list = screen.getByRole('listbox', { name: 'Citation suggestions' });
		expect(list).toHaveAttribute('aria-multiselectable', 'true');
		expect(owner).toHaveAttribute('aria-controls', list.id);
		expect(screen.getByRole('option', { name: /Attention Is All You Need/ })).toHaveTextContent(
			'Vaswani et al. · 2017'
		);
		expect(screen.getByRole('option', { name: /World health/ })).toHaveTextContent(
			'World Health Organization · 2023'
		);
	});

	it('M6-8 AC-1: the manuscript keeps the keys; Enter selects and Tab inserts', async () => {
		const { cl, owner, press } = open();
		const [first, second] = screen.getAllByRole('option');

		expect(owner).toHaveAttribute('aria-activedescendant', first.id);
		expect(press('Enter')).toEqual({ handled: true, prevented: true });
		await vi.waitFor(() => expect(first).toHaveAttribute('aria-selected', 'true'));

		press('ArrowDown');
		await vi.waitFor(() => expect(owner).toHaveAttribute('aria-activedescendant', second.id));

		expect(press('Tab').handled).toBe(true);
		expect(cl).toHaveBeenCalledWith(JSON.stringify(['vaswani']));
	});

	it("M6-8 AC-1: a source with no author is offered, says why it can't be cited, and isn't", async () => {
		const user = userEvent.setup();
		const { cl, press } = open();

		const nameless = screen.getByRole('option', { name: /Minutes of a meeting/ });
		expect(nameless).toHaveAttribute('aria-disabled', 'true');
		expect(nameless).toHaveTextContent("No author, so it can't be cited yet.");
		await user.click(nameless);
		expect(nameless).toHaveAttribute('aria-selected', 'false');

		press('Tab');
		// Nothing chosen: closing without a citation, as before.
		expect(cl).toHaveBeenCalledWith(null);
	});

	it('M6-8 AC-1: a click selects and the button inserts; an organisation is an author', async () => {
		const user = userEvent.setup();
		const { cl } = open();

		const insert = screen.getByRole('button', { name: 'Insert' });
		expect(insert).toBeDisabled();
		await user.click(screen.getByRole('option', { name: /World health/ }));
		await user.click(insert);
		expect(cl).toHaveBeenCalledWith(JSON.stringify(['who']));
	});

	it('M6-8 AC-1: editing opens on the work cited, and unticking it all removes the citation', async () => {
		const user = userEvent.setup();
		const { cl, owner } = open({ initialSelection: ['who'] });

		const who = screen.getByRole('option', { name: /World health/ });
		expect(owner).toHaveAttribute('aria-activedescendant', who.id);
		expect(who).toHaveAttribute('aria-selected', 'true');

		await user.click(who);
		await user.click(screen.getByRole('button', { name: 'Remove' }));
		expect(cl).toHaveBeenCalledWith(null);
	});

	it('M6-8 AC-1: says which kind of nothing: no match, or no sources at all', () => {
		const { owner } = open({ items: [], query: 'vasvani' });
		expect(screen.getByText('No sources match “vasvani”.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Insert' })).not.toBeInTheDocument();
		expect(owner).not.toHaveAttribute('aria-activedescendant');
	});

	it('says when there is nothing to cite yet', () => {
		open({ items: [], query: '' });
		expect(screen.getByText('There are no sources to cite yet.')).toBeInTheDocument();
	});
});

describe('what the picker offers', () => {
	// The options' `items` is synchronous here, whatever TipTap allows.
	const offered = (query: string) =>
		(
			(suggestion({} as Editor) as Required<SuggestionOptions>).items({
				query,
				editor: {} as Editor,
				signal: new AbortController().signal
			}) as CitationItem[]
		).map((item) => item.id);

	it('matches a title, or any author by name', () => {
		expect(offered('')).toEqual(['vaswani', 'nameless', 'who']);
		expect(offered('attention')).toEqual(['vaswani']);
		expect(offered('shazeer')).toEqual(['vaswani']);
	});

	it('matches an organisation by name, rather than throwing on it', () => {
		expect(offered('health organization')).toEqual(['who']);
		expect(offered('minutes')).toEqual(['nameless']);
	});
});
