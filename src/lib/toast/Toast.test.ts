import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Toast, { errorToast, successToast, toasts } from './Toast.svelte';
import userEvent from '@testing-library/user-event';

describe('Toast Component', () => {
	// Mock animations
	Element.prototype.animate ??= vi.fn().mockReturnValue({
		finished: Promise.resolve(),
		cancel: vi.fn(),
		startTime: null,
		currentTime: null
	});

	Element.prototype.getAnimations ??= vi.fn().mockReturnValue([]);

	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
    toasts.length = 0;
	});

	afterEach(() => {
		cleanup();
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it('should remove toast when close button is clicked', async () => {
		const user = userEvent.setup();
		render(Toast);
		const message = 'Test message';
		await successToast(message);

		const toast = screen.getByText(message);
		const closeButton = screen.getByRole('button');

		expect(toast).toBeTruthy();
		await user.click(closeButton);
		expect(screen.queryByText(message)).toBeNull();
	});

	it('should render correctly with success toast', async () => {
		render(Toast);

		const message = 'success message';

		await successToast(message);

		const title = screen.getByText('success');
		const messageInToast = screen.getByText(message);
		const greenDot = document.querySelector('.bg-green-500');

		expect(title).toBeTruthy();
		expect(messageInToast).toBeTruthy();
		expect(greenDot).toBeTruthy();
	});

	it('should render correctly with error toast', async () => {
		render(Toast);

		await errorToast('error message');

		const title = screen.getByText('error');
		const message = screen.getByText('error message');
		const redDot = document.querySelector('.bg-red-500');

		expect(title).toBeTruthy();
		expect(message).toBeTruthy();
		expect(redDot).toBeTruthy();
	});

	it('should automatically remove toast after 5 seconds', async () => {
		render(Toast);

		const message = 'auto remove test';
		await successToast(message);

		await vi.advanceTimersByTimeAsync(5000);

		const toast = screen.queryByText(message);

		expect(toast).toBeNull();
	});

	it('should show multiple toasts simultaneously', async () => {
		render(Toast);

		await successToast('first toast');
		await errorToast('second toast');

		expect(screen.getAllByText(/(first|second) toast/)).toHaveLength(2);
	});

	it('should maintain correct order of toasts', async () => {
		render(Toast);

		await successToast('first');
		await errorToast('second');
		await successToast('third');

  
		const toastTexts = screen.getAllByText(/first|second|third/);

		expect(toastTexts.map((el) => el.textContent)).toEqual(['first', 'second', 'third']);
	});
});
