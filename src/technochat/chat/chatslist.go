package chat

var chatsList = newChatsList()

type ChatsList struct {
	chats map[string]*Chat
}

func newChatsList() *ChatsList {
	return &ChatsList{
		chats: make(map[string]*Chat),
	}
}

func AddChat(c *Chat) {
	chatsList.chats[c.ID] = c
}

func GetChat(id string) *Chat {
	return chatsList.chats[id]
}

func DelChat(id string) {
	delete(chatsList.chats, id)
}
