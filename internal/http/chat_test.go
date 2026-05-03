package http

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"technochat/internal/chat"
	"technochat/internal/chat/message"
	"technochat/pkg/entity"
)

type testDB struct {
	mx sync.Mutex

	chat      entity.Chat
	addChat   entity.Chat
	addErr    error
	getCalls  int
	updateNum int
}

func (db *testDB) Init()     {}
func (db *testDB) Shutdown() {}

func (db *testDB) AddMessage(entity.Message) error { return nil }
func (db *testDB) GetMessage(string) (entity.Message, error) {
	return entity.Message{}, entity.ErrNotFound
}
func (db *testDB) DeleteMessage(string) error            { return nil }
func (db *testDB) AddImage(entity.Image) error           { return nil }
func (db *testDB) GetImage(string) (entity.Image, error) { return entity.Image{}, entity.ErrNotFound }
func (db *testDB) DeleteImage(string) error              { return nil }
func (db *testDB) DeleteChat(string) error               { return nil }
func (db *testDB) GetChat(chatID string) (entity.Chat, error) {
	return db.withGetChat(chatID)
}
func (db *testDB) AddChat(chat entity.Chat) error {
	return db.withAddChat(chat)
}

func (db *testDB) UpdateChat(entity.Chat) error {
	db.mx.Lock()
	defer db.mx.Unlock()

	db.updateNum++

	return nil
}
func (db *testDB) withGetChat(chatID string) (entity.Chat, error) {
	db.mx.Lock()
	defer db.mx.Unlock()

	db.getCalls++
	if db.chat.ID != chatID {
		return entity.Chat{}, entity.ErrNotFound
	}

	return db.chat, nil
}

func (db *testDB) withAddChat(chat entity.Chat) error {
	db.mx.Lock()
	defer db.mx.Unlock()

	db.addChat = chat

	return db.addErr
}

func (db *testDB) updateCount() int {
	db.mx.Lock()
	defer db.mx.Unlock()

	return db.updateNum
}

func (db *testDB) getChatCalls() int {
	db.mx.Lock()
	defer db.mx.Unlock()

	return db.getCalls
}

func (db *testDB) addedChat() entity.Chat {
	db.mx.Lock()
	defer db.mx.Unlock()

	return db.addChat
}

func TestChatConnectRestoresChatLazily(t *testing.T) {
	const chatID = "lazy-restore-chat-test"
	const reconnectToken = "lazy-restore-token"

	db := &testDB{
		chat: entity.Chat{
			ID:        chatID,
			MaxUsers:  1,
			RestJoins: 0,
			Participants: []entity.ChatParticipant{
				{
					ID:             7,
					Name:           "restored user",
					ReconnectToken: reconnectToken,
				},
			},
		},
	}
	s := &Server{db: db}

	server := httptest.NewServer(http.HandlerFunc(s.chatReconnect))
	defer server.Close()

	client := dialTestWebsocket(t, server.URL, "?id="+url.QueryEscape(chatID)+"&reconnect_token="+reconnectToken)
	defer client.Close()

	init := readTestConnInit(t, client)
	if init.Name != "restored user" {
		t.Fatalf("expected restored user name, got %q", init.Name)
	}
	if init.ReconnectToken != reconnectToken {
		t.Fatalf("expected reconnect token to stay stable")
	}
	if db.getChatCalls() != 1 {
		t.Fatalf("expected chat to be read lazily once, got %d reads", db.getChatCalls())
	}
	if db.updateCount() == 0 {
		t.Fatalf("expected reconnect to persist restored chat state")
	}

	restoredChat := chat.GetChat(chatID)
	if restoredChat == nil {
		t.Fatalf("expected chat to be registered after lazy restore")
	}
	restoredChat.TriggerShutdown()
}

func TestChatInitDoesNotRegisterChatWhenPersistFails(t *testing.T) {
	storeErr := errors.New("redis unavailable")
	db := &testDB{addErr: storeErr}
	s := &Server{db: db}

	req, err := http.NewRequest(http.MethodPost, "/api/v1/chat/init", strings.NewReader(`{"max_users":"2"}`))
	if err != nil {
		t.Fatal(err)
	}

	code, _, err := s.chatInit(req)
	if err == nil {
		t.Fatalf("expected chat init to fail")
	}
	if !errors.Is(err, storeErr) {
		t.Fatalf("expected store error %q, got %v", storeErr, err)
	}
	if code != http.StatusInternalServerError {
		t.Fatalf("expected status %d, got %d", http.StatusInternalServerError, code)
	}

	persistedChat := db.addedChat()
	if persistedChat.ID == "" {
		t.Fatalf("expected chat init to try persisting a chat")
	}
	if activeChat := chat.GetChat(persistedChat.ID); activeChat != nil {
		activeChat.TriggerShutdown()
		t.Fatalf("expected failed chat init not to register chat %s in memory", persistedChat.ID)
	}
}

type testConnInit struct {
	Name           string
	ReconnectToken string
}

func dialTestWebsocket(t *testing.T, serverURL string, rawQuery string) *websocket.Conn {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(serverURL, "http") + rawQuery
	client, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("could not dial websocket: %v", err)
	}

	return client
}

func readTestConnInit(t *testing.T, client *websocket.Conn) testConnInit {
	t.Helper()

	if err := client.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("could not set read deadline: %v", err)
	}

	for {
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

		name, ok := eventData["name"].(string)
		if !ok {
			t.Fatalf("expected conn init name, got %#v", eventData["name"])
		}

		reconnectToken, ok := eventData["reconnect_token"].(string)
		if !ok {
			t.Fatalf("expected conn init reconnect token, got %#v", eventData["reconnect_token"])
		}

		return testConnInit{
			Name:           name,
			ReconnectToken: reconnectToken,
		}
	}
}
