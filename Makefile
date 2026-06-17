VERSION ?= dev

.PHONY: all panel agent fmt test release clean

all: panel agent

panel:
	CGO_ENABLED=1 go build -trimpath -o relaycore-panel ./cmd/relaycore-panel

agent:
	go build -trimpath -o relaycore-agent ./cmd/relaycore-agent

fmt:
	gofmt -w cmd internal

test:
	CGO_ENABLED=1 go test ./...

release:
	VERSION=$(VERSION) ./scripts/build-release.sh

clean:
	rm -f relaycore-panel relaycore-agent
	rm -rf dist
