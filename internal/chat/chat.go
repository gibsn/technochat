package chat

import (
	"fmt"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"technochat/internal/chat/message"
	"technochat/internal/chat/typingusers"
	"technochat/internal/chat/user"
)

const (
	DefaultMaxPeople = 2
	MinPeopleInChat  = 2
	MaxPeopleInChat  = 100

	ChatAFKLifetime       time.Duration = 12 * time.Hour
	PresenceBroadcastRate time.Duration = 30 * time.Second
	TypingTTL             time.Duration = 3 * time.Second
	TypingExpireRate      time.Duration = 500 * time.Millisecond
	TypingBroadcastRate   time.Duration = 1 * time.Second
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

	incomingChan  chan *incomingMessage
	broadcastChan chan *message.WSMessage
	typingUsers   *typingusers.TypingUsers

	restJoins         int // how many available invitations are left
	maxUsers          int
	corresps          map[int]*user.User
	correspsMx        sync.RWMutex
	typingBroadcastMx sync.Mutex
}

type incomingMessage struct {
	user *user.User
	msg  *message.WSMessage
}

type NewChatOpts struct {
	ID       string
	MaxJoins int
}

func NewChat(opts NewChatOpts) *Chat {
	c := &Chat{
		ID:                   opts.ID,
		corresps:             make(map[int]*user.User),
		incomingChan:         make(chan *incomingMessage, incomingBufferSize),
		broadcastChan:        make(chan *message.WSMessage, broadcastBufferSize),
		typingUsers:          typingusers.New(TypingTTL),
		restJoins:            opts.MaxJoins,
		maxUsers:             opts.MaxJoins,
		ChatNames:            NewChatNames(),
		triggerShutdownChan:  make(chan struct{}),
		shutdownChan:         make(chan struct{}),
		userConnectedChan:    make(chan *user.User),
		userDisconnectedChan: make(chan *user.User),
	}

	c.WG.Add(2)

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
	createdAt := time.Now().UTC()
	msg := &message.WSMessage{
		Type:      message.WSMsgTypeMessage,
		Name:      "server",
		Data:      str,
		CreatedAt: &createdAt,
	}

	if err := c.Broadcast(msg); err != nil {
		log.Printf("error: chat: could not send server notification in chat %s: %v", c.ID, err)
	}
}

func (c *Chat) Presence() message.Presence {
	c.correspsMx.RLock()
	defer c.correspsMx.RUnlock()

	users := make([]message.PresenceUser, 0, len(c.corresps))
	for _, usr := range c.corresps {
		users = append(users, message.PresenceUser{
			ID:   usr.ID,
			Name: usr.Name,
		})
	}

	sort.Slice(users, func(i, j int) bool {
		return users[i].ID < users[j].ID
	})

	return message.Presence{
		Online: len(users),
		Max:    c.maxUsers,
		Users:  users,
	}
}

func (c *Chat) PresenceMessage() *message.WSMessage {
	return &message.WSMessage{
		Type: message.WSMsgTypeService,
		Data: message.Event{
			EventID:   message.EventPresence,
			EventData: c.Presence(),
		},
	}
}

func (c *Chat) BroadcastPresence() {
	if err := c.Broadcast(c.PresenceMessage()); err != nil {
		log.Printf("error: chat: could not send presence update in chat %s: %v", c.ID, err)
	}
}

func (c *Chat) TypingMessageFor(
	recipientID int,
	typingUsers []message.TypingUser,
) *message.WSMessage {
	return &message.WSMessage{
		Type: message.WSMsgTypeService,
		Data: message.Event{
			EventID:   message.EventTyping,
			EventData: typingusers.UsersFor(typingUsers, recipientID),
		},
	}
}

func (c *Chat) broadcastTypingUsers() {
	c.typingBroadcastMx.Lock()
	defer c.typingBroadcastMx.Unlock()

	c.correspsMx.RLock()
	recipients := make([]*user.User, 0, len(c.corresps))
	for _, usr := range c.corresps {
		recipients = append(recipients, usr)
	}
	c.correspsMx.RUnlock()

	typingUsers := c.typingUsers.Users()

	for _, usr := range recipients {
		msg := c.TypingMessageFor(usr.ID, typingUsers)
		if err := usr.SendMessage(msg); err != nil {
			log.Printf("error: chat: could not send typing update to user %s in chat %s: %v",
				usr.Name, c.ID, err)
		}
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
			c.BroadcastPresence()

		case disconnectedUser := <-c.userDisconnectedChan:
			if c.typingUsers.Remove(disconnectedUser.ID) {
				c.broadcastTypingUsers()
			}

			c.SendServerNotify("user " + disconnectedUser.Name + " has left")
			c.BroadcastPresence()

			if c.Presence().Online == 0 && c.RestJoins() == 0 {
				log.Printf("info: chat: no users left in chat %s", c.ID)
				c.TriggerShutdown()
			}
		}
	}
}

func (c *Chat) handleCommunication() {
	defer c.WG.Done()

	presenceTicker := time.NewTicker(PresenceBroadcastRate)
	defer presenceTicker.Stop()

	typingTicker := time.NewTicker(TypingExpireRate)
	defer typingTicker.Stop()

	lastTypingBroadcastAt := time.Now()
	typingBroadcastPending := false

	for {
		afkTimer := time.NewTimer(ChatAFKLifetime)

		select {
		case incoming := <-c.incomingChan:
			typingBroadcastPending = c.handleIncomingMessage(
				incoming,
				time.Now(),
				&lastTypingBroadcastAt,
				typingBroadcastPending,
			)

		case msg := <-c.broadcastChan:
			c.broadcast(msg)

		case <-presenceTicker.C:
			c.broadcast(c.PresenceMessage())

		case <-typingTicker.C:
			now := time.Now()
			if c.typingUsers.Expire(now) {
				c.broadcastTypingUsers()
				lastTypingBroadcastAt = now
				typingBroadcastPending = false
			} else if typingBroadcastPending && now.Sub(lastTypingBroadcastAt) >= TypingBroadcastRate {
				c.broadcastTypingUsers()
				lastTypingBroadcastAt = now
				typingBroadcastPending = false
			}

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

func (c *Chat) handleIncomingMessage(
	incoming *incomingMessage,
	now time.Time,
	lastTypingBroadcastAt *time.Time,
	typingBroadcastPending bool,
) bool {
	if incoming == nil || incoming.msg == nil || incoming.user == nil {
		return typingBroadcastPending
	}

	switch incoming.msg.Type {
	case message.WSMsgTypeService:
		if !isTypingEvent(incoming.msg) {
			return typingBroadcastPending
		}

		newUser := c.typingUsers.Refresh(typingusers.User{
			ID:   incoming.user.ID,
			Name: incoming.user.Name,
		}, now)
		if newUser || now.Sub(*lastTypingBroadcastAt) >= TypingBroadcastRate {
			c.broadcastTypingUsers()
			*lastTypingBroadcastAt = now
			return false
		}

		return true

	case message.WSMsgTypeMessage:
		if c.typingUsers.Remove(incoming.user.ID) {
			c.broadcastTypingUsers()
			*lastTypingBroadcastAt = now
			typingBroadcastPending = false
		}

		c.broadcast(incoming.msg)

		return typingBroadcastPending
	default:
		return typingBroadcastPending
	}
}

func isTypingEvent(msg *message.WSMessage) bool {
	eventData, ok := msg.Data.(map[string]interface{})
	if !ok {
		return false
	}

	eventID, ok := eventData["event_id"].(float64)
	if !ok {
		return false
	}

	return message.EventID(eventID) == message.EventTyping
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
