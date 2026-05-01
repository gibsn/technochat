package chat

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"technochat/internal/chat/message"
)

type testPresence struct {
	Online int
	Max    int
	Users  []map[string]interface{}
}

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

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	client := dialTestChat(t, server)
	defer client.Close()

	presence := readPresenceEvent(t, client, 1)
	if presence.Max != 3 {
		t.Fatalf("expected max users 3, got %d", presence.Max)
	}
	if len(presence.Users) != 1 {
		t.Fatalf("expected 1 user, got %d", len(presence.Users))
	}
	if presence.Users[0]["name"] == "" {
		t.Fatalf("expected user name in presence event")
	}
}

func TestDisconnectBroadcastsPresenceEvent(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:       "presence-disconnect-test",
		MaxJoins: 3,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	firstClient := dialTestChat(t, server)
	defer firstClient.Close()
	readPresenceEvent(t, firstClient, 1)

	secondClient := dialTestChat(t, server)
	defer secondClient.Close()
	readPresenceEvent(t, firstClient, 2)

	if err := secondClient.Close(); err != nil {
		t.Fatalf("could not close second client: %v", err)
	}

	presence := readPresenceEvent(t, firstClient, 1)
	if presence.Max != 3 {
		t.Fatalf("expected max users 3, got %d", presence.Max)
	}
	if len(presence.Users) != 1 {
		t.Fatalf("expected 1 remaining user, got %d", len(presence.Users))
	}
}

func serveTestChat(t *testing.T, c *Chat) (*httptest.Server, chan struct{}) {
	t.Helper()

	done := make(chan struct{})
	go func() {
		c.Routine()
		close(done)
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

	return server, done
}

func stopTestChat(c *Chat, done chan struct{}) {
	c.TriggerShutdown()
	<-done
}

func dialTestChat(t *testing.T, server *httptest.Server) *websocket.Conn {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	client, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("could not dial websocket: %v", err)
	}

	return client
}

func readPresenceEvent(t *testing.T, client *websocket.Conn, expectedOnline int) testPresence {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	if err := client.SetReadDeadline(deadline); err != nil {
		t.Fatalf("could not set read deadline: %v", err)
	}

	for time.Now().Before(deadline) {
		presence, ok := readNextPresenceEvent(t, client)
		if !ok {
			continue
		}

		if presence.Online == expectedOnline {
			return presence
		}
	}

	t.Fatalf("timed out waiting for presence event with %d online users", expectedOnline)

	return testPresence{}
}

func readNextPresenceEvent(t *testing.T, client *websocket.Conn) (testPresence, bool) {
	t.Helper()

	var wsMsg message.WSMessage
	if err := client.ReadJSON(&wsMsg); err != nil {
		t.Fatalf("could not read websocket message: %v", err)
	}

	event, ok := wsMsg.Data.(map[string]interface{})
	if wsMsg.Type != message.WSMsgTypeService || !ok {
		return testPresence{}, false
	}

	eventID, ok := event["event_id"].(float64)
	if !ok || message.EventID(eventID) != message.EventPresence {
		return testPresence{}, false
	}

	eventData, ok := event["event_data"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected presence event data, got %#v", event["event_data"])
	}

	users, ok := eventData["users"].([]interface{})
	if !ok {
		t.Fatalf("expected users list, got %#v", eventData["users"])
	}

	presence := testPresence{
		Online: int(numberFromPresenceEvent(t, eventData, "online")),
		Max:    int(numberFromPresenceEvent(t, eventData, "max")),
		Users:  make([]map[string]interface{}, 0, len(users)),
	}

	for _, rawUser := range users {
		userData, ok := rawUser.(map[string]interface{})
		if !ok {
			t.Fatalf("expected user object, got %#v", rawUser)
		}

		presence.Users = append(presence.Users, userData)
	}

	return presence, true
}

func numberFromPresenceEvent(t *testing.T, eventData map[string]interface{}, field string) float64 {
	t.Helper()

	value, ok := eventData[field].(float64)
	if !ok {
		t.Fatalf("expected numeric presence field %q, got %s", field, fmt.Sprintf("%#v", eventData[field]))
	}

	return value
}
