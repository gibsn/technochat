package http

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"technochat/pkg/entity"
)

type testDB struct {
	mx sync.Mutex

	chat    entity.Chat
	addChat entity.Chat
	addErr  error
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
	return nil
}
func (db *testDB) withGetChat(chatID string) (entity.Chat, error) {
	db.mx.Lock()
	defer db.mx.Unlock()

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

func (db *testDB) addedChat() entity.Chat {
	db.mx.Lock()
	defer db.mx.Unlock()

	return db.addChat
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
	activeChat, err := s.chatRegistry().GetChat(persistedChat.ID)
	if err != nil {
		t.Fatalf("could not get chat from registry: %v", err)
	}
	if activeChat != nil {
		activeChat.TriggerShutdown()
		t.Fatalf("expected failed chat init not to register chat %s in memory", persistedChat.ID)
	}
}

func TestChatInitUsesConfiguredChatTTL(t *testing.T) {
	db := &testDB{}
	s := &Server{
		db:             db,
		chatOfflineTTL: 2 * time.Hour,
	}

	req, err := http.NewRequest(http.MethodPost, "/api/v1/chat/init", strings.NewReader(`{"max_users":"2"}`))
	if err != nil {
		t.Fatal(err)
	}

	code, _, err := s.chatInit(req)
	if err != nil {
		t.Fatalf("expected chat init to succeed: %v", err)
	}
	if code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, code)
	}
	defer func() {
		activeChat, err := s.chatRegistry().GetChat(db.addedChat().ID)
		if err != nil {
			t.Fatalf("could not get chat from registry: %v", err)
		}
		if activeChat != nil {
			activeChat.TriggerShutdown()
		}
	}()

	persistedChat := db.addedChat()
	if persistedChat.TTL != int((2 * time.Hour).Seconds()) {
		t.Fatalf("expected chat TTL %d, got %d", int((2 * time.Hour).Seconds()), persistedChat.TTL)
	}
}
