package typingusers

import (
	"testing"
	"time"
)

func TestRefreshAddsUserAndExtendsDeadline(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	users := New(3 * time.Second)

	if changed := users.Refresh(User{ID: 1, Name: "Lina"}, now); !changed {
		t.Fatalf("expected first refresh to change visible users")
	}

	typingUsers := UsersFor(users.Users(), 2)
	if len(typingUsers) != 1 {
		t.Fatalf("expected 1 typing user, got %d", len(typingUsers))
	}
	if typingUsers[0].Name != "Lina" {
		t.Fatalf("expected Lina to be typing, got %q", typingUsers[0].Name)
	}
	if !typingUsers[0].ExpiresAt.Equal(now.Add(3 * time.Second)) {
		t.Fatalf("expected initial deadline %s, got %s", now.Add(3*time.Second), typingUsers[0].ExpiresAt)
	}

	later := now.Add(time.Second)
	if changed := users.Refresh(User{ID: 1, Name: "Lina"}, later); changed {
		t.Fatalf("expected repeated refresh to keep visible users unchanged")
	}

	typingUsers = UsersFor(users.Users(), 2)
	if !typingUsers[0].ExpiresAt.Equal(later.Add(3 * time.Second)) {
		t.Fatalf("expected extended deadline %s, got %s", later.Add(3*time.Second), typingUsers[0].ExpiresAt)
	}
}

func TestExpireRemovesElapsedUsers(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	users := New(3 * time.Second)

	users.Refresh(User{ID: 1, Name: "Lina"}, now)

	if changed := users.Expire(now.Add(2 * time.Second)); changed {
		t.Fatalf("expected no expiration before deadline")
	}
	if users.Len() != 1 {
		t.Fatalf("expected user to remain before deadline")
	}

	if changed := users.Expire(now.Add(3 * time.Second)); !changed {
		t.Fatalf("expected user to expire at deadline")
	}
	if users.Len() != 0 {
		t.Fatalf("expected no typing users after expiration")
	}
}

func TestRemoveDeletesUser(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	users := New(3 * time.Second)

	users.Refresh(User{ID: 1, Name: "Lina"}, now)

	if changed := users.Remove(2); changed {
		t.Fatalf("expected removing unknown user to be a no-op")
	}
	if changed := users.Remove(1); !changed {
		t.Fatalf("expected removing active user to change state")
	}
	if users.Len() != 0 {
		t.Fatalf("expected no typing users after remove")
	}
}

func TestUsersForExcludesRecipientAndSorts(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	users := New(3 * time.Second)

	users.Refresh(User{ID: 20, Name: "Axe"}, now)
	users.Refresh(User{ID: 10, Name: "Lina"}, now)

	typingUsers := UsersFor(users.Users(), 20)
	if len(typingUsers) != 1 {
		t.Fatalf("expected one typing user after excluding recipient, got %d", len(typingUsers))
	}
	if typingUsers[0].ID != 10 {
		t.Fatalf("expected recipient to see user 10, got %d", typingUsers[0].ID)
	}

	typingUsers = UsersFor(users.Users(), 99)
	if len(typingUsers) != 2 {
		t.Fatalf("expected two typing users, got %d", len(typingUsers))
	}
	if typingUsers[0].ID != 10 || typingUsers[1].ID != 20 {
		t.Fatalf("expected sorted users [10 20], got [%d %d]", typingUsers[0].ID, typingUsers[1].ID)
	}
}
