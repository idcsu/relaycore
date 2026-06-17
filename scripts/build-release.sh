#!/usr/bin/env bash
set -euo pipefail

VERSION="${VERSION:-dev}"
GOOS_VALUE="${GOOS:-$(go env GOOS)}"
GOARCH_VALUE="${GOARCH:-$(go env GOARCH)}"
OUT_DIR="${OUT_DIR:-dist}"
NAME="relaycore-${VERSION}-${GOOS_VALUE}-${GOARCH_VALUE}"
STAGE="${OUT_DIR}/${NAME}"

rm -rf "$STAGE"
mkdir -p "$STAGE"

echo "Building RelayCore ${VERSION} for ${GOOS_VALUE}/${GOARCH_VALUE}"
LDFLAGS="-X relaycore/internal/common.Version=${VERSION}"
CGO_ENABLED="${CGO_ENABLED:-1}" GOOS="$GOOS_VALUE" GOARCH="$GOARCH_VALUE" go build -trimpath -ldflags "-s -w ${LDFLAGS}" -o "${STAGE}/relaycore-panel" ./cmd/relaycore-panel
GOOS="$GOOS_VALUE" GOARCH="$GOARCH_VALUE" go build -trimpath -ldflags "-s -w ${LDFLAGS}" -o "${STAGE}/relaycore-agent" ./cmd/relaycore-agent

cp -a web deploy scripts docs "$STAGE/"
cp -a Makefile go.mod "$STAGE/"
if [ -f README.md ]; then
  cp -a README.md "$STAGE/"
fi

tar -C "$OUT_DIR" -czf "${OUT_DIR}/${NAME}.tar.gz" "$NAME"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${OUT_DIR}/${NAME}.tar.gz" >"${OUT_DIR}/${NAME}.tar.gz.sha256"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${OUT_DIR}/${NAME}.tar.gz" >"${OUT_DIR}/${NAME}.tar.gz.sha256"
fi

echo "Release archive: ${OUT_DIR}/${NAME}.tar.gz"
