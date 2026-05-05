package chat

import (
	"errors"
	"log"
	"sync"
	"time"

	"technochat/pkg/entity"
)

type Registry struct {
	chats      map[string]*Chat
	restoring  map[string]*restoreCall
	store      RestoreStore
	offlineTTL time.Duration
	pushSender PushSender
	mx         sync.Mutex
}

type restoreCall struct {
	done chan struct{}
	chat *Chat
	err  error
}

type RestoreStore interface {
	StateStore
	GetChat(chatID string) (entity.Chat, error)
	DeleteChat(chatID string) error
}

func NewRegistry(store RestoreStore, pushSenders ...PushSender) *Registry {
	return NewRegistryWithOfflineTTL(store, ChatOfflineTTL, pushSenders...)
}

func NewRegistryWithOfflineTTL(
	store RestoreStore,
	offlineTTL time.Duration,
	pushSenders ...PushSender,
) *Registry {
	if offlineTTL <= 0 {
		offlineTTL = ChatOfflineTTL
	}

	var pushSender PushSender
	if len(pushSenders) > 0 {
		pushSender = pushSenders[0]
	}

	return &Registry{
		chats:      make(map[string]*Chat),
		restoring:  make(map[string]*restoreCall),
		store:      store,
		offlineTTL: offlineTTL,
		pushSender: pushSender,
	}
}

func (r *Registry) AddChat(c *Chat) {
	r.mx.Lock()
	r.chats[c.ID] = c
	r.mx.Unlock()
}

func (r *Registry) AddChatIfAbsent(c *Chat) (*Chat, bool) {
	r.mx.Lock()
	defer r.mx.Unlock()

	existingChat, ok := r.chats[c.ID]
	if ok {
		return existingChat, false
	}

	r.chats[c.ID] = c

	return c, true
}

func (r *Registry) GetChat(id string) (*Chat, error) {
	r.mx.Lock()
	c := r.chats[id]
	store := r.store
	if c != nil || store == nil {
		r.mx.Unlock()

		return c, nil
	}

	if call, ok := r.restoring[id]; ok {
		r.mx.Unlock()
		<-call.done

		return call.chat, call.err
	}

	call := &restoreCall{done: make(chan struct{})}
	r.restoring[id] = call
	r.mx.Unlock()

	call.chat, call.err = r.restoreChat(id, store)

	r.mx.Lock()
	delete(r.restoring, id)
	r.mx.Unlock()

	close(call.done)

	return call.chat, call.err
}

func (r *Registry) restoreChat(id string, store RestoreStore) (*Chat, error) {
	savedChat, err := store.GetChat(id)
	if err != nil {
		if errors.Is(err, entity.ErrNotFound) {
			return nil, nil
		}

		return nil, err
	}

	restoredChat := NewChat(newChatOptsFromState(savedChat, store, r.offlineTTL, r.pushSender))
	activeChat, added := r.AddChatIfAbsent(restoredChat)
	if added {
		go r.HandleChat(activeChat)
		log.Printf("info: chat: restored chat %s for %d people, joins left: %d",
			activeChat.ID, savedChat.MaxUsers, activeChat.RestJoins())
	}

	return activeChat, nil
}

func (r *Registry) DelChat(id string) {
	r.mx.Lock()
	defer r.mx.Unlock()

	c, ok := r.chats[id]
	if !ok {
		return
	}

	log.Printf("info: chat: deleting chat [%s]", c.ID)
	delete(r.chats, c.ID)
}

func (r *Registry) HandleChat(c *Chat) {
	c.Routine()

	r.DelChat(c.ID)

	r.mx.Lock()
	store := r.store
	r.mx.Unlock()

	if store == nil {
		return
	}

	if err := store.DeleteChat(c.ID); err != nil {
		log.Printf("error: chat: could not delete chat %s from db: %v", c.ID, err)
	}
}

func newChatOptsFromState(
	savedChat entity.Chat,
	store StateStore,
	offlineTTL time.Duration,
	pushSender PushSender,
) NewChatOpts {
	participants := make([]Participant, 0, len(savedChat.Participants))
	for _, participant := range savedChat.Participants {
		var pushSubscription *PushSubscription
		if participant.PushSubscription != nil {
			pushSubscription = &PushSubscription{
				Endpoint: participant.PushSubscription.Endpoint,
				Keys: PushKeys{
					Auth:   participant.PushSubscription.Keys.Auth,
					P256DH: participant.PushSubscription.Keys.P256DH,
				},
			}
		}

		participants = append(participants, Participant{
			ID:               participant.ID,
			Name:             participant.Name,
			ReconnectToken:   participant.ReconnectToken,
			PushSubscription: pushSubscription,
		})
	}

	return NewChatOpts{
		ID:               savedChat.ID,
		MaxJoins:         savedChat.MaxUsers,
		RestJoins:        savedChat.RestJoins,
		RestoreRestJoins: true,
		Participants:     participants,
		OfflineTTL:       offlineTTL,
		Store:            store,
		PushSender:       pushSender,
	}
}
