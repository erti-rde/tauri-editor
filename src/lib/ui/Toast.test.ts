import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import UiHarness from './UiHarness.svelte';
import Toast, {
	TOAST_MS,
	dismissToast,
	errorToast,
	successToast,
	toast,
	toasts
} from './Toast.svelte';

/**
 * The toast, rebuilt in the primitives (docs/design-system.md, needed by
 * M5-4 to M5-6: every export ends in one).
 */
describe('Toast', () => {
	Element.prototype.animate ??= vi.fn().mockReturnValue({
		finished: Promise.resolve(),
		cancel: vi.fn(),
		startTime: null,
		currentTime: null
	});
	Element.prototype.getAnimations ??= vi.fn().mockReturnValue([]);

	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		for (const shown of [...toasts]) dismissToast(shown.id);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it('states the fact as its title, and says the kind in words and an icon, not a dot', async () => {
		render(UiHarness, { props: { component: Toast } });

		successToast('Copied the picture.');

		const shown = await screen.findByRole('status');
		expect(shown).toHaveTextContent('Copied the picture.');
		expect(shown).not.toHaveTextContent(/success/i);
		expect(shown.querySelector('svg.text-success')).toBeInTheDocument();
	});

	it('announces an error as an alert, with its reason beneath', async () => {
		render(UiHarness, { props: { component: Toast } });

		errorToast('Couldn’t export the PDF', 'The folder is read-only.');

		const shown = await screen.findByRole('alert');
		expect(shown).toHaveTextContent('Couldn’t export the PDF');
		expect(shown).toHaveTextContent('The folder is read-only.');
		expect(shown.querySelector('svg.text-danger')).toBeInTheDocument();
	});

	it('closes with a button named Close, like every other close button', async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(UiHarness, { props: { component: Toast } });
		successToast('Saved the picture.');

		await user.click(await screen.findByRole('button', { name: 'Close' }));

		expect(screen.queryByText('Saved the picture.')).toBeNull();
	});

	it('goes by itself after six seconds, unless it is an error', async () => {
		render(UiHarness, { props: { component: Toast } });
		successToast('Copied the picture.');
		errorToast('Could not copy that picture.');

		await vi.advanceTimersByTimeAsync(TOAST_MS);

		expect(screen.queryByText('Copied the picture.')).toBeNull();
		expect(screen.getByText('Could not copy that picture.')).toBeInTheDocument();
	});

	it('stays while the pointer is on it, then starts its six seconds again', async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(UiHarness, { props: { component: Toast } });
		successToast('Exported Chapter 1.docx');
		const shown = await screen.findByRole('status');

		await user.hover(shown);
		await vi.advanceTimersByTimeAsync(TOAST_MS * 2);
		expect(screen.getByText('Exported Chapter 1.docx')).toBeInTheDocument();

		await user.unhover(shown);
		await vi.advanceTimersByTimeAsync(TOAST_MS - 100);
		expect(screen.getByText('Exported Chapter 1.docx')).toBeInTheDocument();
		await vi.advanceTimersByTimeAsync(100);
		expect(screen.queryByText('Exported Chapter 1.docx')).toBeNull();
	});

	it('offers one way on, and closes once it is taken', async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const run = vi.fn();
		render(UiHarness, { props: { component: Toast } });
		toast({
			kind: 'success',
			title: 'Exported Chapter 1.docx',
			description: 'Saved to Documents › Thesis.',
			action: { label: 'Show in folder', run }
		});

		await user.click(await screen.findByRole('button', { name: 'Show in folder' }));

		expect(run).toHaveBeenCalledOnce();
		expect(screen.queryByText('Exported Chapter 1.docx')).toBeNull();
	});

	it('shows several at once, oldest first', async () => {
		render(UiHarness, { props: { component: Toast } });

		successToast('first');
		errorToast('second');
		toast({ kind: 'info', title: 'third' });

		await screen.findByText('third');
		expect(screen.getAllByText(/first|second|third/).map((el) => el.textContent)).toEqual([
			'first',
			'second',
			'third'
		]);
	});
});
