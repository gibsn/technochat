package chat

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"technochat/internal/chat/message"
)

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

func TestConnectBroadcastsPresenceEvent(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:       "presence-broadcast-test",
		MaxJoins: 3,
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

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := Upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("could not upgrade websocket: %v", err)
			return
		}

		usr, err := c.AddUser(ws)
		if err != nil {
			t.Errorf("could not add user: %v", err)
			_ = ws.Close()
			return
		}

		usr.Routine()
		c.DelUser(usr.ID)
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	client, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("could not dial websocket: %v", err)
	}
	defer client.Close()

	deadline := time.Now().Add(2 * time.Second)
	if err := client.SetReadDeadline(deadline); err != nil {
		t.Fatalf("could not set read deadline: %v", err)
	}

	for time.Now().Before(deadline) {
		var wsMsg message.WSMessage
		if err := client.ReadJSON(&wsMsg); err != nil {
			t.Fatalf("could not read websocket message: %v", err)
		}

		event, ok := wsMsg.Data.(map[string]interface{})
		if wsMsg.Type != message.WSMsgTypeService || !ok {
			continue
		}

		if eventID, ok := event["event_id"].(float64); !ok || message.EventID(eventID) != message.EventPresence {
			continue
		}

		presence, ok := event["event_data"].(map[string]interface{})
		if !ok {
			t.Fatalf("expected presence event data, got %#v", event["event_data"])
		}

		if online := int(presence["online"].(float64)); online != 1 {
			t.Fatalf("expected 1 online user, got %d", online)
		}
		if maxUsers := int(presence["max"].(float64)); maxUsers != 3 {
			t.Fatalf("expected max users 3, got %d", maxUsers)
		}

		users, ok := presence["users"].([]interface{})
		if !ok {
			t.Fatalf("expected users list, got %#v", presence["users"])
		}
		if len(users) != 1 {
			t.Fatalf("expected 1 user, got %d", len(users))
		}

		userData, ok := users[0].(map[string]interface{})
		if !ok {
			t.Fatalf("expected user object, got %#v", users[0])
		}
		if userData["name"] == "" {
			t.Fatalf("expected user name in presence event")
		}

		return
	}

	t.Fatalf("timed out waiting for presence event")
}
