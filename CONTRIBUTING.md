# Contributing to Erti

We welcome contributions from developers, researchers, and anyone passionate about improving academic writing tools!

## Ways to Contribute

### For Developers

- Fix bugs and implement new features
- Improve performance and code quality
- Add tests and documentation
- Review pull requests

### For Researchers & Academics

- Test the application and report bugs
- Suggest features that would improve your workflow
- Provide feedback on user interface and experience
- Help with documentation and user guides

### For Everyone

- Improve documentation
- Translate the interface
- Share the project with others
- Participate in discussions

## Making Changes

### Before You Start

1. Read [docs/architecture.md](docs/architecture.md): where things live, the rules that must
   not break, and recipes for common changes (a command, a migration, a setting, a panel).
2. Work toward 1.0 is planned in [plan-v1.md](plan-v1.md). Every item has an issue whose title
   starts with its ID (`M1a-8: …`) and acceptance criteria in [docs/specs/](docs/specs/README.md).
   Picking one up is the easiest way to help.
3. For anything else, open an issue first. Ideas outside the plan are weighed for after 1.0.
4. UI is built from the primitives in `src/lib/ui` ([docs/design-system.md](docs/design-system.md)).

### Development Workflow

1. Create a new branch: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Run `pnpm verify` (everything CI runs: lint, types, frontend and Rust tests)
4. Commit with clear, descriptive messages using Conventional Commits
5. Push your branch: `git push origin feature/your-feature-name`
6. Open a Pull Request

### Updating the bundled citation styles

`src-tauri/resources/csl/cslStyles.json` is a snapshot of the independent styles
published by [citation-style-language/styles](https://github.com/citation-style-language/styles).
Upstream renames and removes styles regularly, and every stale entry is a style
that fails to download when a user selects it in Settings.

```bash
pnpm csl:check
```

`pnpm csl:check` diffs the index against the upstream file listing in a single
API call and fails on any entry that no longer exists, explaining what replaced
it. CI runs it weekly (`.github/workflows/csl-styles.yaml`) and on any PR that
touches the index. When it fails:

```bash
pnpm csl:generate
```

`pnpm csl:generate` rebuilds the index from scratch: it lists the repository,
downloads every style to read its `<title>`, and writes the result sorted by
display name. It takes about a minute and doubles as proof that every URL it
writes resolves. Add `--dry-run` to see what would change without writing, and
`--http` to `csl:check` to request every indexed URL rather than trusting the
listing.

Styles under `dependent/` upstream are deliberately excluded: they hold no
formatting rules of their own, so citeproc-js cannot build an engine from one
without first resolving its independent parent.

### Commit Message Format

```txt
feat: add citation export functionality
fix: resolve cross-platform file path issue
docs: update installation instructions
chore: format code according to style guide
```

## Pull Request Process

1. **Ensure your PR addresses an existing issue** or create one first
2. **Update documentation** if you're adding features
3. **Add tests** for new functionality when possible
4. **Ensure all tests pass**
5. **Request review** from maintainers
6. **Address feedback** promptly and thoughtfully

### PR Checklist

The pull request template carries the checklist. For a plan item, tick each acceptance
criterion with where it's proven.

## Reporting Issues

### Bug Reports

Please include:

- **Operating system and version**
- **Application version**
- **Steps to reproduce the bug**
- **Expected vs actual behaviour**
- **Screenshots** (if applicable)
- **Error messages** (if any)

### Feature Requests

Please include:

- **Clear description** of the feature
- **Why it would be useful** to researchers
- **How it might work** (if you have ideas)
- **Examples** from other tools (if relevant)

## Good First Issues

New to the project? Look for issues labelled:

- `good first issue` - Perfect for newcomers
- `documentation` - Help improve our docs
- `bug` - Fix something that's broken
- `enhancement` - Add small improvements

## Questions?

- **GitHub Discussions**: For general questions and ideas
- **GitHub Issues**: For specific bugs or feature requests

Thank you for helping make research writing better for everyone! 🎓✨
