package panel

import (
	"errors"
	"path/filepath"
	"testing"

	"relaycore/internal/common"
)

func TestUserManagementCreateDisableAndReset(t *testing.T) {
	store, actor := testUserStore(t)
	created, generated, err := store.CreateUser("alice", "", common.RoleUser, actor, "127.0.0.1")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if created.PasswordHash != "" {
		t.Fatalf("created user leaked password hash")
	}
	if generated == "" {
		t.Fatalf("expected generated password")
	}
	if _, ok, _ := store.Login("alice", generated, ""); !ok {
		t.Fatalf("created user cannot login with generated password")
	}
	sess, err := store.CreateSession(created, "127.0.0.1", "test")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	if _, ok := store.UserBySession(sess.Token); !ok {
		t.Fatalf("session should be valid before disable")
	}
	disabled, err := store.UpdateUser(created.ID, common.RoleUser, true, actor, "127.0.0.1")
	if err != nil {
		t.Fatalf("disable user: %v", err)
	}
	if !disabled.Disabled {
		t.Fatalf("user should be disabled")
	}
	if _, ok := store.UserBySession(sess.Token); ok {
		t.Fatalf("disabled user's session should be removed")
	}
	updated, resetPassword, err := store.ResetUserPassword(created.ID, "", actor, "127.0.0.1")
	if err != nil {
		t.Fatalf("reset password: %v", err)
	}
	if updated.PasswordHash != "" {
		t.Fatalf("reset user leaked password hash")
	}
	if resetPassword == "" {
		t.Fatalf("expected generated reset password")
	}
}

func TestCannotDisableOrDemoteLastSuperAdmin(t *testing.T) {
	store, actor := testUserStore(t)
	if _, err := store.UpdateUser(actor.ID, common.RoleSuperAdmin, true, actor, "127.0.0.1"); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected self-disable to be rejected, got %v", err)
	}
	otherAdmin, _, err := store.CreateUser("admin2", "long-password-123", common.RoleAdmin, actor, "127.0.0.1")
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	if _, err := store.UpdateUser(actor.ID, common.RoleAdmin, false, otherAdmin, "127.0.0.1"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("non-super admin should not demote super admin, got %v", err)
	}
}

func testUserStore(t *testing.T) (*Store, common.User) {
	t.Helper()
	store, _, err := OpenStore(filepath.Join(t.TempDir(), "relaycore.db"), "admin", "admin-password-123")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	users := store.ListUsers()
	if len(users) != 1 {
		t.Fatalf("expected one bootstrap user, got %d", len(users))
	}
	return store, users[0]
}
