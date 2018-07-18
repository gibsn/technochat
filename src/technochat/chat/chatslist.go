package chat

import (
	"log"
	"sync"
)

var chatsListMutex sync.Mutex
var chatsList = newChatsList()

type ChatsList struct {
	chats map[string]*Chat
	mx    sync.Mutex
}

func newChatsList() *ChatsList {
	return &ChatsList{
		chats: make(map[string]*Chat),
	}
}

func AddChat(c *Chat) {
	chatsList.mx.Lock()
	chatsList.chats[c.ID] = c
	chatsList.mx.Unlock()
	go c.HandleChatBroadcast()
}

func GetChat(id string) *Chat {
	chatsList.mx.Lock()
	defer chatsList.mx.Unlock()
	return chatsList.chats[id]
}

func DelChat(id string) {
	chatsList.mx.Lock()
	c := chatsList.chats[id]
	chatsList.mx.Unlock()

	if c == nil {
		return
	}

	log.Printf("info: chat: deleting chat id=%s", id)

	c.terminate <- struct{}{}

	chatsList.mx.Lock()
	delete(chatsList.chats, id)
	chatsList.mx.Unlock()
}
