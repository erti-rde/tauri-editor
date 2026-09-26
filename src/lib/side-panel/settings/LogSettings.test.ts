import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import { useFakeBackend } from '$lib/harness/testing';

import LogSettings from './LogSettings.svelte';

const backend = useFakeBackend();

// M1a-12 AC-5
describe('the log in Settings', () => {
	it('opens the folder the log is in', async () => {
		const { getByRole } = render(LogSettings);
		await fireEvent.click(getByRole('button', { name: 'Open log folder' }));
		await waitFor(() => expect(backend().calls.map((c) => c.cmd)).toContain('open_log_folder'));
	});

	it('says what the log holds, and what it never does', () => {
		const { getByText } = render(LogSettings);
		expect(getByText(/never holds what you wrote/)).toBeInTheDocument();
	});
});
