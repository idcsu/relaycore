package common

import (
	"testing"
	"time"
)

func TestTOTPVerify(t *testing.T) {
	secret := "JBSWY3DPEHPK3PXP"
	now := time.Unix(1710000000, 0)
	_, ok := VerifyTOTP(secret, hotp(secret, uint64(now.Unix()/30)), now)
	if !ok {
		t.Fatal("expected current TOTP code to verify")
	}
	if _, ok := VerifyTOTP(secret, "000000", now); ok {
		t.Fatal("unexpected verification for invalid code")
	}
}
