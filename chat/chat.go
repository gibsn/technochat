package chat

import (
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"technochat/chat/message"
	"technochat/chat/user"
)

const (
	DefaultMaxPeople = 2
	MinPeopleInChat  = 2
	MaxPeopleInChat  = 100

	ChatAFKLifetime time.Duration = 12 * time.Hour
)

const (
	incomingBufferSize  = 10
	broadcastBufferSize = 10
)

var Upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Chat struct {
	ID        string
	ChatNames ChatNames

	triggerShutdown     sync.Once
	triggerShutdownChan chan struct{}
	shutdownChan        chan struct{}
	WG                  sync.WaitGroup

	userConnectedChan    chan *user.User
	userDisconnectedChan chan *user.User
	usersWG              sync.WaitGroup

	incomingChan  chan *message.WSMessage
	broadcastChan chan *message.WSMessage

	restJoins  int // how many available invitations are left
	corresps   map[int]*user.User
	correspsMx sync.RWMutex
}

type NewChatOpts struct {
	ID       string
	MaxJoins int
}

func NewChat(opts NewChatOpts) *Chat {
	c := &Chat{
		ID:                   opts.ID,
		corresps:             make(map[int]*user.User),
		incomingChan:         make(chan *message.WSMessage, incomingBufferSize),
		broadcastChan:        make(chan *message.WSMessage, broadcastBufferSize),
		restJoins:            opts.MaxJoins,
		ChatNames:            NewChatNames(),
		triggerShutdownChan:  make(chan struct{}),
		shutdownChan:         make(chan struct{}),
		userConnectedChan:    make(chan *user.User),
		userDisconnectedChan: make(chan *user.User),
	}

	c.WG.Add(2) //nolint: gomnd

	go c.handleUsers()
	go c.handleCommunication()

	return c
}

func (c *Chat) RestJoins() int {
	c.correspsMx.RLock()
	defer c.correspsMx.RUnlock()

	return c.restJoins
}

func (c *Chat) SendServerNotify(str string) {
	msg := &message.WSMessage{
		Type: message.WSMsgTypeMessage,
		Name: "server",
		Data: str,
	}

	if err := c.Broadcast(msg); err != nil {
		log.Printf("error: chat: could not send server notification in chat %s: %v", c.ID, err)
	}
}

func (c *Chat) broadcast(msg *message.WSMessage) {
	c.correspsMx.RLock()
	defer c.correspsMx.RUnlock()

	for _, usr := range c.corresps {
		c.correspsMx.RUnlock()
		if err := usr.SendMessage(msg); err != nil {
			log.Printf("errof: chat: could not send a message to user %s in chat %s: %v",
				usr.Name, c.ID, err)
		}

		c.correspsMx.RLock()
	}
}

func (c *Chat) Broadcast(msg *message.WSMessage) error {
	select {
	case c.broadcastChan <- msg:
	default:
		return fmt.Errorf("queue is full")
	}

	return nil
}

func (c *Chat) handleUsers() {
	defer c.WG.Done()

	for {
		select {
		case <-c.shutdownChan:
			log.Printf("info: chat: closing users goroutine for chat [%s]", c.ID)
			return

		case newUser := <-c.userConnectedChan:
			if err := newUser.SendEvent(message.EventConnInitOk, newUser.Name); err != nil {
				log.Printf("error: could not greet a new user from %s: %v", newUser.Addr(), err)
				newUser.TriggerShutdown()
				return
			}

			c.SubscribeUser(newUser)
			c.SendServerNotify("user " + newUser.Name + " has joined")

		case disconnectedUser := <-c.userDisconnectedChan:
			c.SendServerNotify("user " + disconnectedUser.Name + " has left")

			if len(c.corresps) == 0 && c.restJoins == 0 {
				log.Printf("info: chat: no users left in chat %s", c.ID)
				c.TriggerShutdown()
			}
		}
	}
}

func (c *Chat) handleCommunication() {
	defer c.WG.Done()

	for {
		afkTimer := time.NewTimer(ChatAFKLifetime)

		select {
		case msg := <-c.incomingChan:
			c.broadcast(msg)

		case msg := <-c.broadcastChan:
			c.broadcast(msg)

		case <-c.shutdownChan:
			log.Printf("info: chat: closing communication goroutine for chat [%s]", c.ID)
			return

		case <-afkTimer.C:
			log.Printf("info: chat: no activity in chat %s for %s, shutting down", c.ID, ChatAFKLifetime)
			c.SendServerNotify("closing chat due to inactivity for " + ChatAFKLifetime.String())
			c.TriggerShutdown()

			return
		}

		afkTimer.Stop()
	}
}

func (c *Chat) TriggerShutdown() {
	c.triggerShutdown.Do(func() {
		close(c.triggerShutdownChan)
	})
}

func (c *Chat) Routine() {
	<-c.triggerShutdownChan

	log.Printf("info: chat: triggered shutdown for chat [%s]", c.ID)

	c.ShutdownUsers()

	close(c.shutdownChan)
	c.WG.Wait()
}
