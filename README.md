## Setup python

project uses python v3.11
- create python envirnomnent `python -m venv .venv`
- activate `.venv` (can be different for different operating systems check [python guide](https://docs.python.org/3/library/venv.html) for this)
- pip install -r requirements.txt

## install npm depenceies

run `pnpm install`

## Build Python API

run `pnpm build:fastapi`


## install rust
for installing Tuari and rust [check platform specific](https://tauri.app/v1/guides/getting-started/prerequisites) installation

## Developing

Once you've created a project and installed dependencies with `pnpm install` start a development server:

```bash
pnpm tauri dev
```

## Building

To create a production version of your app:

```bash
pnpm run tauri build
```
