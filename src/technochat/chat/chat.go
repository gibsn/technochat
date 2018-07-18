package chat

import (
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	DefaultMaxPeople = 2
	MinPeopleInChat  = 2
	MaxPeopleInChat  = 100

	ChatAFKLifetime time.Duration = 12 * time.Hour
)

const (
	pingTimer   time.Duration = 30 * time.Second
	pingTimeout time.Duration = 1 * time.Second
)

var Upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Chat struct {
	ID        string
	ChatNames ChatNames

	broadcast chan WSMessage
	terminate chan struct{}

	corresps   map[int]*User
	correspsMx sync.Mutex

	restJoins int
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
		send: make(chan WSMessage),
	}
	c.correspsMx.Lock()
	c.corresps[usr.ID] = usr
	c.correspsMx.Unlock()
	c.restJoins--

	go c.HandleUserSending(usr)

	return usr
}

func (c *Chat) DelUser(id int) {
	c.correspsMx.Lock()
	corr := c.corresps[id]
	c.correspsMx.Unlock()

	if corr == nil {
		return
	}
	log.Printf("chat: deleting user id=%d name=%s", id, corr.Name)

	corr.terminateSend <- struct{}{}
	corr.WS.Close()

	c.correspsMx.Lock()
	delete(c.corresps, id)
	c.correspsMx.Unlock()

	if len(c.corresps) == 0 && c.restJoins == 0 {
		DelChat(c.ID)
	}
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
		case <-c.terminate:
			return
		case msg := <-c.broadcast:
			c.correspsMx.Lock()
			for _, usr := range c.corresps {
				c.correspsMx.Unlock()
				select {
				case usr.send <- msg:
				default:
					log.Printf("error: chat: cant send broadcast msg to user %s", usr.Name)
				}
				c.correspsMx.Lock()
			}
			c.correspsMx.Unlock()
		case <-time.After(ChatAFKLifetime):
			log.Printf("chat: no activity in chat for %s. chat will be terminated", ChatAFKLifetime)
			DelChat(c.ID)
		}
	}
}

func (c *Chat) HandleUserSending(usr *User) {
	for {
		select {
		case <-usr.terminateSend:
			return
		case msg := <-usr.send:
			err := usr.WS.WriteJSON(msg)
			if err != nil {
				log.Printf("error: chat: cant send a message to user %s: %v", usr.Name, err)
				c.DelUser(usr.ID)
				return
			}
		case <-time.After(pingTimer):
			err := usr.WS.WriteControl(websocket.PingMessage, nil, time.Now().Add(pingTimeout))
			if err != nil {
				log.Printf("error: chat: cant send a ping message to user %s: %v", usr.Name, err)
				c.DelUser(usr.ID)
				return
			}
		}
	}
}
