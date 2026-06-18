package agent

import (
	"errors"
	"testing"
)

func TestIsUnknownNodeError(t *testing.T) {
	if !isUnknownNodeError(errors.New("unknown node")) {
		t.Fatalf("expected unknown node error to match")
	}
	if isUnknownNodeError(errors.New("token already used")) {
		t.Fatalf("did not expect unrelated error to match")
	}
}
