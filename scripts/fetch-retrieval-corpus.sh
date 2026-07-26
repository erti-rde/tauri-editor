#!/usr/bin/env bash
#
# Downloads the open-access papers used by the retrieval benchmark.
#
# The PDFs are NOT committed: they are ~29 MB, and fetching them on demand avoids
# redistributing third-party work. Each file is pinned to a specific arXiv version
# and verified against the SHA-256 in tests/fixtures/retrieval/corpus.json, so the
# benchmark corpus is reproducible without vendoring the binaries.
#
# Usage: ./scripts/fetch-retrieval-corpus.sh [target-dir]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$REPO_ROOT/tests/fixtures/retrieval/corpus.json"
TARGET="${1:-$REPO_ROOT/tests/fixtures/retrieval/papers}"

command -v jq >/dev/null 2>&1 || { echo "error: jq is required" >&2; exit 1; }

mkdir -p "$TARGET"

sha_of() {
	if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
	else shasum -a 256 "$1" | cut -d' ' -f1
	fi
}

total=$(jq length "$MANIFEST")
ok=0
failed=0

for i in $(seq 0 $((total - 1))); do
	id=$(jq -r ".[$i].id" "$MANIFEST")
	url=$(jq -r ".[$i].url" "$MANIFEST")
	want=$(jq -r ".[$i].sha256" "$MANIFEST")
	dest="$TARGET/$id.pdf"

	if [ -f "$dest" ] && [ "$(sha_of "$dest")" = "$want" ]; then
		printf '  %-16s cached\n' "$id"
		ok=$((ok + 1))
		continue
	fi

	if ! curl -sSL --max-time 120 -o "$dest" "$url"; then
		printf '  %-16s DOWNLOAD FAILED\n' "$id"
		rm -f "$dest"
		failed=$((failed + 1))
		continue
	fi

	got=$(sha_of "$dest")
	if [ "$got" != "$want" ]; then
		printf '  %-16s CHECKSUM MISMATCH\n     expected %s\n     got      %s\n' "$id" "$want" "$got"
		rm -f "$dest"
		failed=$((failed + 1))
		continue
	fi

	printf '  %-16s ok\n' "$id"
	ok=$((ok + 1))
	sleep 1 # be polite to arXiv
done

echo "---"
echo "$ok/$total verified, $failed failed -> $TARGET"
[ "$failed" -eq 0 ]
