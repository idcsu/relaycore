VERSION ?= dev

.PHONY: all panel agent web web-install fmt test release clean

all: panel agent

panel:
	CGO_ENABLED=1 go build -trimpath -o relaycore-panel ./cmd/relaycore-panel

agent:
	go build -trimpath -o relaycore-agent ./cmd/relaycore-agent

# Build the React/Vite frontend into web/ (the panel serves it as static files).
# Requires Node.js + npm. The built assets in web/ are committed so deploys do
# not need Node, but rerun this whenever the frontend source changes.
web: web-install
	cd frontend && npm run build

web-install:
	cd frontend && npm install

fmt:
	gofmt -w cmd internal

test:
	CGO_ENABLED=1 go test ./...

release:
	VERSION=$(VERSION) ./scripts/build-release.sh

clean:
	rm -f relaycore-panel relaycore-agent
	rm -rf dist
