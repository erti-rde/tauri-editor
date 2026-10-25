import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import StatusFooter, { setStatus, removeStatus } from './StatusFooter.svelte';

describe('StatusFooter Component', () => {
	afterEach(() => {
		cleanup();
	});
	it('should render the component with information', async () => {
		render(StatusFooter);
		await setStatus({
			side: 'left',
			message: 'Status Footer',
			type: 'info'
		});
		expect(screen.getByText('Status Footer')).toBeTruthy();
	});

	it('M6-8 AC-1: says an error in words, not with a red "X"', async () => {
		render(StatusFooter);
		await setStatus({
			side: 'left',
			message: 'Error processing PDFs: the disk is full',
			type: 'error'
		});
		const status = screen.getByText('Error processing PDFs: the disk is full');
		expect(status).toBeTruthy();
		expect(screen.queryByText('X')).toBeNull();
		// The words are full ink; only the icon beside them carries the colour.
		expect(status.closest('.text-ink')).not.toBeNull();
	});

	it('M6-8 AC-1: tells finished work from work under way', async () => {
		const { container } = render(StatusFooter);
		await setStatus({ side: 'left', message: 'Processing PDFs: 1/3', type: 'info' });
		expect(container.querySelector('.motion-safe\\:animate-spin')).not.toBeNull();

		await setStatus({ side: 'left', message: 'Completed processing 3 PDF files', type: 'done' });
		expect(container.querySelector('.motion-safe\\:animate-spin')).toBeNull();
		expect(container.querySelector('.text-success')).not.toBeNull();
	});

	it('should remove the status after 3 seconds', async () => {
		render(StatusFooter);
		await setStatus({
			side: 'left',
			message: 'Status Footer',
			type: 'info'
		});
		expect(screen.getByText('Status Footer')).toBeTruthy();
		await removeStatus();
		expect(screen.queryByText('Status Footer')).toBeNull();
	});
});
