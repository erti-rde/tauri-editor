import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
	addFromDoi: vi.fn(),
	networkAllowed: vi.fn(),
	errorToast: vi.fn()
}));
vi.mock('./fromDoi', () => ({ addFromDoi: mocks.addFromDoi }));
vi.mock('$lib/stores/consent', () => ({ networkAllowed: mocks.networkAllowed }));
vi.mock('$lib/toast/Toast.svelte', () => ({ errorToast: mocks.errorToast }));

import type { AugmentedZoteroSchema } from './adapterCslZotero';
import AddFromDoi from './AddFromDoi.svelte';

const schema = {} as AugmentedZoteroSchema;

function show() {
	const onsource = vi.fn();
	const onbyhand = vi.fn();
	render(AddFromDoi, { props: { open: true, schema, onsource, onbyhand } });
	return { onsource, onbyhand };
}

beforeEach(() => mocks.networkAllowed.mockResolvedValue(true));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('AddFromDoi', () => {
	it('opens with the field focused, ready for the DOI', async () => {
		show();
		const field = await screen.findByRole('textbox', { name: 'DOI' });
		await vi.waitFor(() => expect(document.activeElement).toBe(field));
	});

	// M1b-6 AC-1
	it('looks a DOI up, and hands on the source it added', async () => {
		const { onsource } = show();
		mocks.addFromDoi.mockResolvedValue({ kind: 'added', id: 'erti:x', title: 'Deep learning' });

		await userEvent.type(
			await screen.findByRole('textbox', { name: 'DOI' }),
			'10.1038/nature14539'
		);
		await userEvent.click(await screen.findByRole('button', { name: 'Look up' }));

		expect(mocks.addFromDoi).toHaveBeenCalledWith('10.1038/nature14539', schema, { lookUp: true });
		expect(onsource).toHaveBeenCalledWith({ kind: 'added', id: 'erti:x', title: 'Deep learning' });
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	// M1b-6 AC-2
	it('with lookups off, says so and offers the details to enter, DOI and all', async () => {
		mocks.networkAllowed.mockResolvedValue(false);
		const { onbyhand } = show();
		mocks.addFromDoi.mockResolvedValue({ kind: 'by-hand', doi: '10.1038/nature14539' });

		expect(await screen.findByText('Online lookups are off.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Look up' })).toBeNull();
		await userEvent.type(screen.getByRole('textbox', { name: 'DOI' }), '10.1038/nature14539');
		await userEvent.click(screen.getByRole('button', { name: 'Enter details' }));

		expect(mocks.addFromDoi).toHaveBeenCalledWith('10.1038/nature14539', schema, {
			lookUp: false
		});
		expect(onbyhand).toHaveBeenCalledWith('10.1038/nature14539');
	});

	// M1b-6 AC-3
	it('hands on a source the library has already', async () => {
		const { onsource } = show();
		mocks.addFromDoi.mockResolvedValue({ kind: 'existing', id: 'erti:lecun' });

		await userEvent.type(await screen.findByRole('textbox', { name: 'DOI' }), '10.1038/x{Enter}');

		expect(onsource).toHaveBeenCalledWith({ kind: 'existing', id: 'erti:lecun' });
	});

	it('says when doi.org has nothing, and offers the details to enter instead', async () => {
		const { onbyhand } = show();
		mocks.addFromDoi.mockResolvedValueOnce({ kind: 'not-found', doi: '10.1000/missing' });

		await userEvent.type(await screen.findByRole('textbox', { name: 'DOI' }), '10.1000/missing');
		await userEvent.click(await screen.findByRole('button', { name: 'Look up' }));
		expect(await screen.findByText(/doi.org has no details for 10.1000\/missing/)).toBeTruthy();

		mocks.addFromDoi.mockResolvedValueOnce({ kind: 'by-hand', doi: '10.1000/missing' });
		await userEvent.click(screen.getByRole('button', { name: 'Enter details' }));
		expect(mocks.addFromDoi).toHaveBeenLastCalledWith('10.1000/missing', schema, {
			lookUp: false
		});
		expect(onbyhand).toHaveBeenCalledWith('10.1000/missing');
	});

	it('says when what was typed isn’t a DOI, and stays open', async () => {
		show();
		mocks.addFromDoi.mockResolvedValue({ kind: 'not-a-doi' });

		await userEvent.type(await screen.findByRole('textbox', { name: 'DOI' }), 'nature14539');
		await userEvent.click(await screen.findByRole('button', { name: 'Look up' }));

		expect(await screen.findByText(/That isn’t a DOI/)).toBeInTheDocument();
		expect(screen.getByRole('dialog')).toBeInTheDocument();
	});
});
