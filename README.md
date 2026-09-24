# Erti

> Erti (ერთი) is Georgian word for one.

A cross-platform research writing application designed specifically for researchers and academics.

## Why This Exists

The project exists to help researchers on their tasks and help them to focus on the research. We are aiming to create software that becomes the only needed software for research. Bringing reading, writing, note taking, learning and sharing in one place. Find out more on our [landing page](https://erti-beta.netlify.app/).

The tool will be always free and it will be never sold to anyone. It's aiming to be something that is created for users rather than to make money and monetise users.

Erti runs completely on your machine and works offline. Your research and data never leave your computer without your explicit consent.

Concretely, Erti asks once before anything is sent, and works fully offline if you decline.

If you allow lookups, this is what leaves the machine and nothing else:

- **The identifier printed in a paper** — its DOI or arXiv ID — sent to `doi.org` to fetch authors, title and journal. `doi.org` passes the request on to the registry that issued the identifier: `api.crossref.org` for most journal articles, `data.crosscite.org` for arXiv and DataCite. This is the usual case: it resolved every paper in our benchmark corpus.
- **Only when no identifier can be found**, a search query to `crossref.org` containing the paper's **title and authors** — or, if the PDF's embedded title is unusable, **the first 400 characters of its opening page**.
- **An email address, if you enter one** in Settings, which Crossref asks for so it can contact you about heavy use. Optional and blank by default.
- **A citation style file** from GitHub (`raw.githubusercontent.com`), only when you choose one that doesn't come with Erti, and the citation language file that goes with it. Seven common styles (APA, Chicago, Harvard, IEEE, MLA, Vancouver) and English citation text ship with the app and work offline.

That list is enforced, not only promised: the app's content security policy allows connections to those four hosts and refuses every other.

Your PDFs, your notes and your writing are never uploaded, in any case. The search that finds relevant passages runs entirely on your machine.

If you decline, Erti still reads the identifier printed inside each paper — which is enough on its own for most papers — and you can paste a DOI or type the details in by hand.

We are also using ML model in the software to help users to find citations. And we are always carefully thinking ethics and potentials of using ML models in our software. They also run on your machine and any interaction with it will stay locally as well. The software will not be using GAI (Generative Artificial Intelligence) except really rare cases where community concluded that it's good idea to use.

Why are we not jumping on GAI train and make everything very easy for researchers and academics?

- We believe that research should be done by humans and Generative AI [can reduce human cognitive abilities](https://www.media.mit.edu/publications/your-brain-on-chatgpt/), which is essential for research.

**IN SHORT**: Erti exists to help the most ethical way possible.

## Download and Installation

Erti is build using [Tauri](https://tauri.app/) and [SvelteKit](https://svelte.dev/docs/kit/introduction). The installation of Tauri will depend on your OS.

- For installing Tauri and Rust [check platform specific](https://tauri.app/start/prerequisites/) installation
- Once you have Tauri and Rust installed run `pnpm install` to install remaining dependencies.
- Start a development server: `pnpm tauri dev`

### Building

To create a production version of your app:

```bash
pnpm run tauri build
```

## Development Status

This project is in active development. We welcome contributions from developers, researchers, and anyone interested in improving academic writing tools.

## Contributing

We'd love your help! Whether you're a developer, researcher, or have ideas for features, see our [CONTRIBUTING.md](CONTRIBUTING.md) for how to get involved.

## License

This project is licensed under the GNU Affero General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

This means:

- ✅ You can use, modify, and distribute this code
- ✅ You must keep it open source
- ⚠️ If you use this in a web service, your entire application must be open source
- ❌ You cannot use this in proprietary/closed-source projects
