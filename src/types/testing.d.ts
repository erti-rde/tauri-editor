// Registers jest-dom's matchers (toBeInTheDocument, toHaveClass, …) for the test
// suite. Previously done with `types: ["@testing-library/jest-dom"]` in
// tsconfig.json, but that resolves against `typeRoots`, and jest-dom lives at
// node_modules/@testing-library/ rather than node_modules/@types/ — so it broke
// as soon as the package updated. A triple-slash reference resolves normally.
/// <reference types="@testing-library/jest-dom" />
