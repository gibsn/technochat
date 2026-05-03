package chat

import (
	"errors"
	"log"
	"sync"

	"technochat/pkg/entity"
)

type Registry struct {
	chats map[string]*Chat
	store RestoreStore
	mx    sync.Mutex
}

type RestoreStore interface {
	StateStore
	GetChat(chatID string) (entity.Chat, error)
	DeleteChat(chatID string) error
}

func NewRegistry(store RestoreStore) *Registry {
	return &Registry{
		chats: make(map[string]*Chat),
		store: store,
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
	r.mx.Unlock()

	if c != nil || store == nil {
		return c, nil
	}

	savedChat, err := store.GetChat(id)
	if err != nil {
		if errors.Is(err, entity.ErrNotFound) {
			return nil, nil
		}

		return nil, err
	}

	restoredChat := NewChat(newChatOptsFromState(savedChat, store))
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

func newChatOptsFromState(savedChat entity.Chat, store StateStore) NewChatOpts {
	participants := make([]Participant, 0, len(savedChat.Participants))
	for _, participant := range savedChat.Participants {
		participants = append(participants, Participant{
			ID:             participant.ID,
			Name:           participant.Name,
			ReconnectToken: participant.ReconnectToken,
		})
	}

	return NewChatOpts{
		ID:               savedChat.ID,
		MaxJoins:         savedChat.MaxUsers,
		RestJoins:        savedChat.RestJoins,
		RestoreRestJoins: true,
		Participants:     participants,
		Store:            store,
	}
}
