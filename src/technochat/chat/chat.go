package chat

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const DefaultMaxPeople = 2
const MinPeopleInChat = 2
const MaxPeopleInChat = 100
const ChatAFKLifetime = 360 // in seconds

var Upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Chat struct {
	ID        string
	broadcast chan WSMessage
	corresps  map[int]*User
	restJoins int
	ChatNames ChatNames
}

type NewChatOpts struct {
	ID       string
	MaxJoins int
}

func NewChat(opts NewChatOpts) *Chat {
	return &Chat{
		ID:        opts.ID,
		corresps:  make(map[int]*User),
		broadcast: make(chan WSMessage),
		restJoins: opts.MaxJoins,
		ChatNames: NewChatNames(),
	}
}

func (c *Chat) RestJoins() int {
	return c.restJoins
}

func (c *Chat) AddUser(ws *websocket.Conn) *User {
	if c.restJoins <= 0 {
		return nil
	}

	name, id := c.ChatNames.GenerateNameID()
	usr := &User{
		WS:   ws,
		Name: name,
		ID:   id,
	}
	c.corresps[usr.ID] = usr
	c.restJoins--
	return usr
}

func (c *Chat) DelUser(id int) {
	c.corresps[id].WS.Close()
	delete(c.corresps, id)
}

func (c *Chat) SendServerNotify(str string) {
	c.SendAll(WSMessage{
		Type: WSMsgTypeMessage,
		Name: "server",
		Data: str,
	})
}

func (c *Chat) SendAll(msg WSMessage) {
	c.broadcast <- msg
}

func (c *Chat) HandleChatBroadcast() {
	for {
		select {
		case <-time.After(ChatAFKLifetime * time.Second):
			for id, _ := range c.corresps { //TODO: refactor
				c.DelUser(id)
			}
			DelChat(c.ID)
			return
		case msg := <-c.broadcast:
			for id, usr := range c.corresps {
				err := usr.WS.WriteJSON(msg)
				if err != nil {
					log.Printf("error: chat: could not send a message to user %s: %v", usr.Name, err)
					c.DelUser(id)
				}
			}
		}
	}
}
