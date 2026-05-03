package chat

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"technochat/internal/chat/message"
	"technochat/internal/chat/user"
	"technochat/pkg/entity"
)

type testPresence struct {
	Online int
	Max    int
	Users  []map[string]interface{}
}

type testTypingUser struct {
	ID        int
	Name      string
	ExpiresAt time.Time
}

type testConnInit struct {
	Name           string
	ReconnectToken string
}

type testChatStateStore struct {
	mx     sync.Mutex
	err    error
	states []entity.Chat
}

func (s *testChatStateStore) UpdateChat(chat entity.Chat) error {
	s.mx.Lock()
	defer s.mx.Unlock()

	if s.err != nil {
		return s.err
	}

	s.states = append(s.states, chat)

	return nil
}

func (s *testChatStateStore) lastState() (entity.Chat, bool) {
	s.mx.Lock()
	defer s.mx.Unlock()

	if len(s.states) == 0 {
		return entity.Chat{}, false
	}

	return s.states[len(s.states)-1], true
}

func (s *testChatStateStore) stateCount() int {
	s.mx.Lock()
	defer s.mx.Unlock()

	return len(s.states)
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

func TestAddUserPersistsChatState(t *testing.T) {
	store := &testChatStateStore{}
	c := NewChat(NewChatOpts{
		ID:       "state-persist-test",
		MaxJoins: 2,
		Store:    store,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	client := dialTestChat(t, server)
	defer closeTestClient(t, client)
	readPresenceEvent(t, client, 1)

	state, ok := store.lastState()
	if !ok {
		t.Fatalf("expected chat state to be persisted")
	}
	if state.ID != c.ID {
		t.Fatalf("expected chat ID %q, got %q", c.ID, state.ID)
	}
	if state.MaxUsers != 2 {
		t.Fatalf("expected max users 2, got %d", state.MaxUsers)
	}
	if state.RestJoins != 1 {
		t.Fatalf("expected 1 rest join, got %d", state.RestJoins)
	}
	if len(state.Participants) != 1 {
		t.Fatalf("expected 1 persisted participant, got %d", len(state.Participants))
	}
	if state.Participants[0].ReconnectToken == "" {
		t.Fatalf("expected reconnect token to be persisted")
	}
	if state.TTL != int(ChatOfflineTTL.Seconds()) {
		t.Fatalf("expected TTL %d, got %d", int(ChatOfflineTTL.Seconds()), state.TTL)
	}
}

func TestAddUserRollsBackJoinWhenStateStoreFails(t *testing.T) {
	storeErr := errors.New("store unavailable")
	store := &testChatStateStore{err: storeErr}
	c := NewChat(NewChatOpts{
		ID:       "state-persist-fail-test",
		MaxJoins: 2,
		Store:    store,
	})

	addErr := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := Upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("could not upgrade websocket: %v", err)
			return
		}
		defer func() {
			if err := ws.Close(); err != nil {
				t.Errorf("could not close websocket: %v", err)
			}
		}()

		_, err = c.AddUser(ws)
		addErr <- err
	}))
	defer server.Close()

	client := dialTestChat(t, server)
	defer closeTestClient(t, client)

	select {
	case err := <-addErr:
		if err == nil {
			t.Fatalf("expected add user to fail")
		}
		if !strings.Contains(err.Error(), storeErr.Error()) {
			t.Fatalf("expected store error %q, got %v", storeErr, err)
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for add user")
	}

	if restJoins := c.RestJoins(); restJoins != 2 {
		t.Fatalf("expected rest joins to be rolled back to 2, got %d", restJoins)
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
	defer closeTestClient(t, client)

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

func TestReconnectDoesNotConsumeQuotaAndRestoresUser(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:       "reconnect-quota-test",
		MaxJoins: 1,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	firstClient := dialTestChat(t, server)
	firstInit := readConnInitEvent(t, firstClient)
	if firstInit.ReconnectToken == "" {
		t.Fatalf("expected reconnect token")
	}
	if c.RestJoins() != 0 {
		t.Fatalf("expected join quota to be exhausted, got %d", c.RestJoins())
	}

	reconnectedClient := dialTestChatPath(t, server, "/reconnect?reconnect_token="+firstInit.ReconnectToken)
	defer closeTestClient(t, reconnectedClient)

	secondInit := readConnInitEvent(t, reconnectedClient)
	if secondInit.Name != firstInit.Name {
		t.Fatalf("expected reconnect to restore user %q, got %q", firstInit.Name, secondInit.Name)
	}
	if secondInit.ReconnectToken != firstInit.ReconnectToken {
		t.Fatalf("expected reconnect token to stay stable")
	}
	if c.RestJoins() != 0 {
		t.Fatalf("expected reconnect to keep join quota at 0, got %d", c.RestJoins())
	}

	closeTestClient(t, firstClient)
}

func TestRestoredParticipantCanReconnect(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:               "restored-reconnect-test",
		MaxJoins:         1,
		RestJoins:        0,
		RestoreRestJoins: true,
		Participants: []Participant{
			{
				ID:             7,
				Name:           "restored user",
				ReconnectToken: "restored-token",
			},
		},
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	client := dialTestChatPath(t, server, "/reconnect?reconnect_token=restored-token")
	defer closeTestClient(t, client)

	init := readConnInitEvent(t, client)
	if init.Name != "restored user" {
		t.Fatalf("expected restored user name, got %q", init.Name)
	}
	if init.ReconnectToken != "restored-token" {
		t.Fatalf("expected restored reconnect token, got %q", init.ReconnectToken)
	}
	if c.RestJoins() != 0 {
		t.Fatalf("expected restored reconnect to keep join quota at 0, got %d", c.RestJoins())
	}
}

func TestReconnectRefreshesPersistedChatState(t *testing.T) {
	store := &testChatStateStore{}
	c := NewChat(NewChatOpts{
		ID:               "reconnect-refresh-state-test",
		MaxJoins:         1,
		RestJoins:        0,
		RestoreRestJoins: true,
		Participants: []Participant{
			{
				ID:             7,
				Name:           "restored user",
				ReconnectToken: "restored-token",
			},
		},
		Store: store,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	client := dialTestChatPath(t, server, "/reconnect?reconnect_token=restored-token")
	defer closeTestClient(t, client)
	readConnInitEvent(t, client)

	state, ok := store.lastState()
	if !ok {
		t.Fatalf("expected reconnect to refresh persisted chat state")
	}
	if state.TTL != int(ChatOfflineTTL.Seconds()) {
		t.Fatalf("expected TTL %d, got %d", int(ChatOfflineTTL.Seconds()), state.TTL)
	}
	if len(state.Participants) != 1 || state.Participants[0].ReconnectToken != "restored-token" {
		t.Fatalf("expected restored participant to stay persisted, got %#v", state.Participants)
	}
}

func TestIncomingMessageRefreshesPersistedChatState(t *testing.T) {
	store := &testChatStateStore{}
	c := NewChat(NewChatOpts{
		ID:       "message-refresh-state-test",
		MaxJoins: 1,
		Store:    store,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	client := dialTestChat(t, server)
	defer closeTestClient(t, client)
	readConnInitEvent(t, client)

	initialStateCount := store.stateCount()
	if initialStateCount == 0 {
		t.Fatalf("expected join to persist initial chat state")
	}

	if err := client.WriteJSON(message.WSMessage{
		Type: message.WSMsgTypeMessage,
		Data: "hello",
	}); err != nil {
		t.Fatalf("could not write chat message: %v", err)
	}

	waitForPersistedStates(t, store, initialStateCount+1)

	state, ok := store.lastState()
	if !ok {
		t.Fatalf("expected message activity to refresh persisted chat state")
	}
	if state.TTL != int(ChatOfflineTTL.Seconds()) {
		t.Fatalf("expected TTL %d, got %d", int(ChatOfflineTTL.Seconds()), state.TTL)
	}
}

func TestDisconnectKeepsChatAliveUntilOfflineTTL(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:         "disconnect-offline-ttl-test",
		MaxJoins:   1,
		OfflineTTL: 200 * time.Millisecond,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChatIfRunning(c, done)

	firstClient := dialTestChat(t, server)
	firstInit := readConnInitEvent(t, firstClient)
	closeTestClient(t, firstClient)
	waitForOnlineUsers(t, c, 0)

	reconnectedClient := dialTestChatPath(t, server, "/reconnect?reconnect_token="+firstInit.ReconnectToken)
	defer closeTestClient(t, reconnectedClient)

	secondInit := readConnInitEvent(t, reconnectedClient)
	if secondInit.Name != firstInit.Name {
		t.Fatalf("expected reconnect to restore user %q, got %q", firstInit.Name, secondInit.Name)
	}

	select {
	case <-done:
		t.Fatal("chat closed before offline TTL elapsed")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestOfflineTTLClosesChatAfterLastDisconnect(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:         "offline-ttl-close-test",
		MaxJoins:   1,
		OfflineTTL: 100 * time.Millisecond,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChatIfRunning(c, done)

	client := dialTestChat(t, server)
	readConnInitEvent(t, client)
	closeTestClient(t, client)
	waitForOnlineUsers(t, c, 0)

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("chat did not close after offline TTL elapsed")
	}
}

func TestJoinBlockedWhenQuotaExhausted(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:       "join-quota-test",
		MaxJoins: 1,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	firstClient := dialTestChat(t, server)
	defer closeTestClient(t, firstClient)
	readConnInitEvent(t, firstClient)

	secondClient := dialTestChat(t, server)
	defer closeTestClient(t, secondClient)

	eventID := readConnInitEventID(t, secondClient)
	if eventID != message.EventConnInitMaxUsrsReached {
		t.Fatalf("expected max users event, got %d", eventID)
	}
}

func TestReconnectFailsWithInvalidToken(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:       "invalid-reconnect-test",
		MaxJoins: 1,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	client := dialTestChatPath(t, server, "/reconnect?reconnect_token=nope")
	defer closeTestClient(t, client)

	eventID := readConnInitEventID(t, client)
	if eventID != message.EventConnInitInvalidReconnectToken {
		t.Fatalf("expected invalid reconnect event, got %d", eventID)
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
	defer closeTestClient(t, firstClient)
	readPresenceEvent(t, firstClient, 1)

	secondClient := dialTestChat(t, server)
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

func TestTypingEventBroadcastsTypingUsers(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:       "typing-broadcast-test",
		MaxJoins: 3,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	firstClient := dialTestChat(t, server)
	defer closeTestClient(t, firstClient)
	readPresenceEvent(t, firstClient, 1)

	secondClient := dialTestChat(t, server)
	defer closeTestClient(t, secondClient)
	readPresenceEvent(t, secondClient, 2)

	writeTypingEvent(t, firstClient)

	typingUsers := readTypingEvent(t, secondClient)
	if len(typingUsers) != 1 {
		t.Fatalf("expected one typing user, got %d", len(typingUsers))
	}
	if typingUsers[0].Name == "" {
		t.Fatalf("expected typing user name")
	}
	if !typingUsers[0].ExpiresAt.After(time.Now()) {
		t.Fatalf("expected typing user expiration to be in the future")
	}
}

func TestTypingEventDoesNotEchoUserToSelf(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:       "typing-self-test",
		MaxJoins: 2,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	client := dialTestChat(t, server)
	defer closeTestClient(t, client)
	readPresenceEvent(t, client, 1)

	writeTypingEvent(t, client)

	typingUsers := readTypingEvent(t, client)
	if len(typingUsers) != 0 {
		t.Fatalf("expected user not to see themselves typing, got %d users", len(typingUsers))
	}
}

func TestMessageClearsTypingState(t *testing.T) {
	c := NewChat(NewChatOpts{
		ID:       "typing-message-clear-test",
		MaxJoins: 3,
	})

	server, done := serveTestChat(t, c)
	defer server.Close()
	defer stopTestChat(c, done)

	firstClient := dialTestChat(t, server)
	defer closeTestClient(t, firstClient)
	readPresenceEvent(t, firstClient, 1)

	secondClient := dialTestChat(t, server)
	defer closeTestClient(t, secondClient)
	readPresenceEvent(t, secondClient, 2)

	writeTypingEvent(t, firstClient)
	if typingUsers := readTypingEvent(t, secondClient); len(typingUsers) != 1 {
		t.Fatalf("expected one typing user, got %d", len(typingUsers))
	}

	if err := firstClient.WriteJSON(message.WSMessage{
		Type: message.WSMsgTypeMessage,
		Data: "hello",
	}); err != nil {
		t.Fatalf("could not write chat message: %v", err)
	}

	typingUsers := readTypingEvent(t, secondClient)
	if len(typingUsers) != 0 {
		t.Fatalf("expected message to clear typing users, got %d users", len(typingUsers))
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

		var usr *user.User
		if r.URL.Path == "/reconnect" {
			usr, err = c.ReconnectUser(ws, r.URL.Query().Get("reconnect_token"))
		} else {
			usr, err = c.AddUser(ws)
		}
		if err != nil {
			eventID := message.EventConnInitNoSuchChat
			if err == ErrInvitationQuotaExceeded {
				eventID = message.EventConnInitMaxUsrsReached
			}
			if err == ErrInvalidReconnectToken {
				eventID = message.EventConnInitInvalidReconnectToken
			}
			if writeErr := ws.WriteJSON(message.WSMessage{
				Type: message.WSMsgTypeService,
				Data: message.Event{
					EventID: eventID,
				},
			}); writeErr != nil {
				t.Errorf("could not write error event: %v", writeErr)
			}
			_ = ws.Close()
			return
		}

		usr.Routine()
		c.DelUser(usr)
	}))

	return server, done
}

func stopTestChat(c *Chat, done chan struct{}) {
	c.TriggerShutdown()
	<-done
}

func stopTestChatIfRunning(c *Chat, done chan struct{}) {
	select {
	case <-done:
	default:
		stopTestChat(c, done)
	}
}

func waitForOnlineUsers(t *testing.T, c *Chat, expectedOnline int) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if c.Presence().Online == expectedOnline {
			return
		}

		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("timed out waiting for %d online users, got %d", expectedOnline, c.Presence().Online)
}

func waitForPersistedStates(t *testing.T, store *testChatStateStore, expectedStates int) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if store.stateCount() >= expectedStates {
			return
		}

		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("timed out waiting for %d persisted states, got %d", expectedStates, store.stateCount())
}

func dialTestChat(t *testing.T, server *httptest.Server) *websocket.Conn {
	t.Helper()

	return dialTestChatPath(t, server, "")
}

func dialTestChatPath(t *testing.T, server *httptest.Server, path string) *websocket.Conn {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + path
	client, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("could not dial websocket: %v", err)
	}

	return client
}

func readConnInitEvent(t *testing.T, client *websocket.Conn) testConnInit {
	t.Helper()

	eventData := readConnInitEventData(t, client)

	return testConnInit{
		Name:           stringFromConnInitEvent(t, eventData, "name"),
		ReconnectToken: stringFromConnInitEvent(t, eventData, "reconnect_token"),
	}
}

func readConnInitEventID(t *testing.T, client *websocket.Conn) message.EventID {
	t.Helper()

	if err := client.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("could not set read deadline: %v", err)
	}

	var wsMsg message.WSMessage
	if err := client.ReadJSON(&wsMsg); err != nil {
		t.Fatalf("could not read websocket message: %v", err)
	}

	event, ok := wsMsg.Data.(map[string]interface{})
	if wsMsg.Type != message.WSMsgTypeService || !ok {
		t.Fatalf("expected service event, got %#v", wsMsg)
	}

	eventID, ok := event["event_id"].(float64)
	if !ok {
		t.Fatalf("expected conn init event id, got %#v", event["event_id"])
	}

	return message.EventID(eventID)
}

func readConnInitEventData(t *testing.T, client *websocket.Conn) map[string]interface{} {
	t.Helper()

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

		eventID, ok := event["event_id"].(float64)
		if !ok || message.EventID(eventID) != message.EventConnInitOk {
			continue
		}

		eventData, ok := event["event_data"].(map[string]interface{})
		if !ok {
			t.Fatalf("expected conn init event data, got %#v", event["event_data"])
		}

		return eventData
	}

	t.Fatalf("timed out waiting for conn init event")

	return nil
}

func stringFromConnInitEvent(t *testing.T, eventData map[string]interface{}, field string) string {
	t.Helper()

	value, ok := eventData[field].(string)
	if !ok {
		t.Fatalf("expected string conn init field %q, got %s", field, fmt.Sprintf("%#v", eventData[field]))
	}

	return value
}

func closeTestClient(t *testing.T, client *websocket.Conn) {
	t.Helper()

	if err := client.Close(); err != nil {
		t.Fatalf("could not close websocket client: %v", err)
	}
}

func writeTypingEvent(t *testing.T, client *websocket.Conn) {
	t.Helper()

	if err := client.WriteJSON(message.WSMessage{
		Type: message.WSMsgTypeService,
		Data: message.Event{
			EventID: message.EventTyping,
		},
	}); err != nil {
		t.Fatalf("could not write typing event: %v", err)
	}
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

func readTypingEvent(t *testing.T, client *websocket.Conn) []testTypingUser {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	if err := client.SetReadDeadline(deadline); err != nil {
		t.Fatalf("could not set read deadline: %v", err)
	}

	for time.Now().Before(deadline) {
		typingUsers, ok := readNextTypingEvent(t, client)
		if !ok {
			continue
		}

		return typingUsers
	}

	t.Fatalf("timed out waiting for typing event")

	return nil
}

func readNextTypingEvent(t *testing.T, client *websocket.Conn) ([]testTypingUser, bool) {
	t.Helper()

	var wsMsg message.WSMessage
	if err := client.ReadJSON(&wsMsg); err != nil {
		t.Fatalf("could not read websocket message: %v", err)
	}

	event, ok := wsMsg.Data.(map[string]interface{})
	if wsMsg.Type != message.WSMsgTypeService || !ok {
		return nil, false
	}

	eventID, ok := event["event_id"].(float64)
	if !ok || message.EventID(eventID) != message.EventTyping {
		return nil, false
	}

	eventUsers, ok := event["event_data"].([]interface{})
	if !ok {
		t.Fatalf("expected typing users list, got %#v", event["event_data"])
	}

	typingUsers := make([]testTypingUser, 0, len(eventUsers))
	for _, rawUser := range eventUsers {
		userData, ok := rawUser.(map[string]interface{})
		if !ok {
			t.Fatalf("expected typing user object, got %#v", rawUser)
		}

		expiresAt, ok := userData["expires_at"].(string)
		if !ok {
			t.Fatalf("expected expires_at string, got %#v", userData["expires_at"])
		}

		parsedExpiresAt, err := time.Parse(time.RFC3339Nano, expiresAt)
		if err != nil {
			t.Fatalf("could not parse expires_at %q: %v", expiresAt, err)
		}

		typingUsers = append(typingUsers, testTypingUser{
			ID:        int(numberFromTypingEvent(t, userData, "id")),
			Name:      stringFromTypingEvent(t, userData, "name"),
			ExpiresAt: parsedExpiresAt,
		})
	}

	return typingUsers, true
}

func numberFromPresenceEvent(t *testing.T, eventData map[string]interface{}, field string) float64 {
	t.Helper()

	value, ok := eventData[field].(float64)
	if !ok {
		t.Fatalf("expected numeric presence field %q, got %s", field, fmt.Sprintf("%#v", eventData[field]))
	}

	return value
}

func numberFromTypingEvent(t *testing.T, eventData map[string]interface{}, field string) float64 {
	t.Helper()

	value, ok := eventData[field].(float64)
	if !ok {
		t.Fatalf("expected numeric typing field %q, got %s", field, fmt.Sprintf("%#v", eventData[field]))
	}

	return value
}

func stringFromTypingEvent(t *testing.T, eventData map[string]interface{}, field string) string {
	t.Helper()

	value, ok := eventData[field].(string)
	if !ok {
		t.Fatalf("expected string typing field %q, got %s", field, fmt.Sprintf("%#v", eventData[field]))
	}

	return value
}
