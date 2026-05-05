package chat

import (
	"sync"
	"testing"
	"time"

	"technochat/pkg/entity"
)

type testRestoreStore struct {
	mx sync.Mutex

	chat     entity.Chat
	getCalls int

	getStartedOnce sync.Once
	getStarted     chan struct{}
	getRelease     chan struct{}
	deleteDone     chan struct{}
}

func (s *testRestoreStore) UpdateChat(entity.Chat) error {
	return nil
}

func (s *testRestoreStore) GetChat(chatID string) (entity.Chat, error) {
	s.mx.Lock()
	s.getCalls++
	s.mx.Unlock()

	if s.getStarted != nil {
		s.getStartedOnce.Do(func() {
			close(s.getStarted)
		})
	}
	if s.getRelease != nil {
		<-s.getRelease
	}

	if s.chat.ID != chatID {
		return entity.Chat{}, entity.ErrNotFound
	}

	return s.chat, nil
}

func (s *testRestoreStore) DeleteChat(string) error {
	if s.deleteDone != nil {
		close(s.deleteDone)
	}

	return nil
}

func (s *testRestoreStore) getCallCount() int {
	s.mx.Lock()
	defer s.mx.Unlock()

	return s.getCalls
}

func TestRegistryRestoresChatLazily(t *testing.T) {
	const chatID = "registry-lazy-restore-test"

	store := &testRestoreStore{
		chat: entity.Chat{
			ID:        chatID,
			MaxUsers:  1,
			RestJoins: 0,
			Participants: []entity.ChatParticipant{
				{
					ID:             7,
					Name:           "restored user",
					ReconnectToken: "restored-token",
				},
			},
		},
		deleteDone: make(chan struct{}),
	}
	registry := NewRegistry(store)

	restoredChat, err := registry.GetChat(chatID)
	if err != nil {
		t.Fatalf("could not restore chat: %v", err)
	}
	if restoredChat == nil {
		t.Fatalf("expected chat to be restored")
	}
	if restoredChat.ID != chatID {
		t.Fatalf("expected restored chat ID %q, got %q", chatID, restoredChat.ID)
	}
	if restoredChat.RestJoins() != 0 {
		t.Fatalf("expected restored joins to be 0, got %d", restoredChat.RestJoins())
	}

	cachedChat, err := registry.GetChat(chatID)
	if err != nil {
		t.Fatalf("could not get cached chat: %v", err)
	}
	if cachedChat != restoredChat {
		t.Fatalf("expected registry to return cached chat")
	}
	if store.getCallCount() != 1 {
		t.Fatalf("expected one store read, got %d", store.getCallCount())
	}

	stopRegistryChat(t, restoredChat, store.deleteDone)
}

func TestRegistryRestoresChatWithConfiguredOfflineTTL(t *testing.T) {
	const chatID = "registry-restore-ttl-test"

	store := &testRestoreStore{
		chat: entity.Chat{
			ID:        chatID,
			MaxUsers:  1,
			RestJoins: 0,
		},
		deleteDone: make(chan struct{}),
	}
	registry := NewRegistryWithOfflineTTL(store, 2*time.Hour)

	restoredChat, err := registry.GetChat(chatID)
	if err != nil {
		t.Fatalf("could not restore chat: %v", err)
	}
	if restoredChat == nil {
		t.Fatalf("expected chat to be restored")
	}

	state := restoredChat.State()
	if state.TTL != int((2 * time.Hour).Seconds()) {
		t.Fatalf("expected restored chat TTL %d, got %d", int((2 * time.Hour).Seconds()), state.TTL)
	}

	stopRegistryChat(t, restoredChat, store.deleteDone)
}

func TestRegistryCoalescesConcurrentLazyRestore(t *testing.T) {
	const chatID = "registry-concurrent-restore-test"
	const callers = 10

	store := &testRestoreStore{
		chat: entity.Chat{
			ID:        chatID,
			MaxUsers:  1,
			RestJoins: 0,
			Participants: []entity.ChatParticipant{
				{
					ID:             7,
					Name:           "restored user",
					ReconnectToken: "restored-token",
				},
			},
		},
		getStarted: make(chan struct{}),
		getRelease: make(chan struct{}),
		deleteDone: make(chan struct{}),
	}
	registry := NewRegistry(store)

	results := make(chan *Chat, callers)
	errs := make(chan error, callers)
	for i := 0; i < callers; i++ {
		go func() {
			restoredChat, err := registry.GetChat(chatID)
			results <- restoredChat
			errs <- err
		}()
	}

	<-store.getStarted
	time.Sleep(50 * time.Millisecond)
	close(store.getRelease)

	var firstChat *Chat
	for i := 0; i < callers; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("could not restore chat: %v", err)
		}

		restoredChat := <-results
		if restoredChat == nil {
			t.Fatalf("expected restored chat")
		}
		if firstChat == nil {
			firstChat = restoredChat
			continue
		}
		if restoredChat != firstChat {
			t.Fatalf("expected all callers to get the same chat instance")
		}
	}

	if store.getCallCount() != 1 {
		t.Fatalf("expected concurrent restore to read store once, got %d reads", store.getCallCount())
	}

	stopRegistryChat(t, firstChat, store.deleteDone)
}

func stopRegistryChat(t *testing.T, c *Chat, done chan struct{}) {
	t.Helper()

	c.TriggerShutdown()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for restored chat shutdown")
	}
}
