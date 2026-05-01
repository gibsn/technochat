package chat

import "testing"

func TestPresenceReportsConfiguredMaxUsers(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:       "presence-test",
		MaxJoins: 5,
	})

	done := make(chan struct{})
	go func() {
		c.Routine()
		close(done)
	}()
	defer func() {
		c.TriggerShutdown()
		<-done
	}()

	presence := c.Presence()
	if presence.Online != 0 {
		t.Fatalf("expected no online users, got %d", presence.Online)
	}
	if presence.Max != 5 {
		t.Fatalf("expected max users 5, got %d", presence.Max)
	}
	if len(presence.Users) != 0 {
		t.Fatalf("expected empty users list, got %d users", len(presence.Users))
	}
}
