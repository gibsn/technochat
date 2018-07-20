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
}

func GetChat(id string) *Chat {
	chatsList.mx.Lock()
	defer chatsList.mx.Unlock()

	return chatsList.chats[id]
}

func DelChat(id string) {
	chatsList.mx.Lock()
	defer chatsList.mx.Unlock()

	c, ok := chatsList.chats[id]
	if !ok {
		return
	}

	log.Printf("info: chat: deleting chat [%s]", c.ID)
	delete(chatsList.chats, c.ID)
}

func HandleChat(c *Chat) {
	c.Routine()

	DelChat(c.ID)
}
