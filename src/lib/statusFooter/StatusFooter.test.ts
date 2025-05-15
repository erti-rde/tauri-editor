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

	it('should render the component with error', async () => {
		render(StatusFooter);
		await setStatus({
			side: 'left',
			message: 'Status Footer',
			type: 'error'
		});
		expect(screen.getByText('Status Footer')).toBeTruthy();
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
