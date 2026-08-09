import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not implement matchMedia, and the appearance layer asks it which
 * theme the OS is in. Stubbed as "light" so components under test render the
 * branch a user on a light machine sees.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		})
	});
}
