package chat

import (
	"fmt"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"technochat/internal/chat/message"
	"technochat/internal/chat/typingusers"
	"technochat/internal/chat/user"
)

const (
	DefaultMaxPeople = 2
	MinPeopleInChat  = 2
	MaxPeopleInChat  = 100

	ChatOfflineTTL        time.Duration = 24 * time.Hour
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

	incomingChan     chan *incomingMessage
	broadcastChan    chan *message.WSMessage
	offlineStateChan chan bool
	offlineTTL       time.Duration
	typingUsers      *typingusers.TypingUsers

	restJoins         int // how many available invitations are left
	maxUsers          int
	participants      map[string]*Participant
	participantByID   map[int]*Participant
	corresps          map[int]*user.User
	pushSubscriptions map[int]PushSubscription
	pushSender        PushSender
	nextMessageSeq    uint64
	correspsMx        sync.RWMutex
	typingBroadcastMx sync.Mutex
}

type incomingMessage struct {
	user *user.User
	msg  *message.WSMessage
}

type Participant struct {
	ID             int
	Name           string
	ReconnectToken string
}

type NewChatOpts struct {
	ID         string
	MaxJoins   int
	OfflineTTL time.Duration
	PushSender PushSender
}

func NewChat(opts NewChatOpts) *Chat {
	offlineTTL := opts.OfflineTTL
	if offlineTTL <= 0 {
		offlineTTL = ChatOfflineTTL
	}

	c := &Chat{
		ID:                   opts.ID,
		participants:         make(map[string]*Participant),
		participantByID:      make(map[int]*Participant),
		corresps:             make(map[int]*user.User),
		pushSubscriptions:    make(map[int]PushSubscription),
		pushSender:           opts.PushSender,
		incomingChan:         make(chan *incomingMessage, incomingBufferSize),
		broadcastChan:        make(chan *message.WSMessage, broadcastBufferSize),
		offlineStateChan:     make(chan bool, 1),
		offlineTTL:           offlineTTL,
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
	recipients := c.recipients()

	if msg != nil && msg.Type == message.WSMsgTypeMessage {
		log.Printf(
			"info: chat: broadcasting message chat=%s sender=%q recipients=%d "+
				"message_id=%s message_seq=%d data=%s",
			c.ID, msg.Name, len(recipients), msg.MessageID, msg.MessageSeq, message.DataForLog(msg.Data),
		)
	}

	for _, usr := range recipients {
		if err := usr.SendMessage(msg); err != nil {
			log.Printf("error: chat: could not send a message to user %s in chat %s: %v",
				usr.Name, c.ID, err)
		}
	}
}

func (c *Chat) recipients() []*user.User {
	c.correspsMx.RLock()
	defer c.correspsMx.RUnlock()

	recipients := make([]*user.User, 0, len(c.corresps))
	for _, usr := range c.corresps {
		recipients = append(recipients, usr)
	}

	return recipients
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
			if err := newUser.SendEvent(message.EventConnInitOk, message.ConnInit{
				Name:           newUser.Name,
				ReconnectToken: newUser.ReconnectToken,
			}); err != nil {
				log.Printf("error: could not greet a new user from %s: %v", newUser.Addr(), err)
				newUser.TriggerShutdown()
				return
			}

			c.SubscribeUser(newUser)
			c.SendServerNotify("user " + newUser.Name + " has joined")
			c.BroadcastPresence()
			c.notifyOfflineState(false)

		case disconnectedUser := <-c.userDisconnectedChan:
			if c.typingUsers.Remove(disconnectedUser.ID) {
				c.broadcastTypingUsers()
			}

			c.SendServerNotify("user " + disconnectedUser.Name + " has left")
			c.BroadcastPresence()

			if c.Presence().Online == 0 {
				c.notifyOfflineState(true)
			}
		}
	}
}

func (c *Chat) notifyOfflineState(offline bool) {
	select {
	case c.offlineStateChan <- offline:
		return
	default:
	}

	select {
	case <-c.offlineStateChan:
	default:
	}

	select {
	case c.offlineStateChan <- offline:
	default:
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

	offlineTimer := time.NewTimer(c.offlineTTL)
	offlineTimerC := offlineTimer.C
	defer stopTimer(offlineTimer)

	for {
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

		case offline := <-c.offlineStateChan:
			if offline {
				resetTimer(offlineTimer, c.offlineTTL, &offlineTimerC)
				log.Printf("info: chat: all users left chat %s, closing in %s", c.ID, c.offlineTTL)
			} else {
				stopTimer(offlineTimer)
				offlineTimerC = nil
			}

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

		case <-offlineTimerC:
			log.Printf("info: chat: no online users in chat %s for %s, shutting down", c.ID, c.offlineTTL)
			c.TriggerShutdown()

			return
		}
	}
}

func stopTimer(timer *time.Timer) {
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
}

func resetTimer(timer *time.Timer, ttl time.Duration, timerC *<-chan time.Time) {
	stopTimer(timer)
	timer.Reset(ttl)
	*timerC = timer.C
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
		log.Printf(
			"info: chat: incoming service message chat=%s user_id=%d user_name=%q remote=%s data=%s",
			c.ID, incoming.user.ID, incoming.user.Name, incoming.user.Addr(),
			message.DataForLog(incoming.msg.Data),
		)

		eventID, ok := eventIDFromMessage(incoming.msg)
		if !ok {
			return typingBroadcastPending
		}

		if eventID == message.EventPushSubscribe {
			if subscription, ok := pushSubscriptionFromMessage(incoming.msg); ok {
				c.UpsertPushSubscription(incoming.user.ID, subscription)
			}
			return typingBroadcastPending
		}
		if eventID == message.EventPushUnsubscribe {
			c.DeletePushSubscription(incoming.user.ID)
			return typingBroadcastPending
		}

		if eventID != message.EventTyping {
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
		c.prepareChatMessage(incoming.msg)

		log.Printf(
			"info: chat: incoming chat message chat=%s user_id=%d user_name=%q remote=%s "+
				"message_id=%s message_seq=%d data=%s",
			c.ID, incoming.user.ID, incoming.user.Name, incoming.user.Addr(),
			incoming.msg.MessageID, incoming.msg.MessageSeq, message.DataForLog(incoming.msg.Data),
		)

		if c.typingUsers.Remove(incoming.user.ID) {
			c.broadcastTypingUsers()
			*lastTypingBroadcastAt = now
			typingBroadcastPending = false
		}

		c.broadcast(incoming.msg)
		c.sendPushToOfflineParticipants(incoming.user.ID, &messageForPush{
			MessageID:  incoming.msg.MessageID,
			MessageSeq: incoming.msg.MessageSeq,
			Sender:     incoming.msg.Name,
			Data:       incoming.msg.Data,
			Timestamp:  incoming.msg.CreatedAt.Format(time.RFC3339Nano),
		})

		return typingBroadcastPending
	default:
		return typingBroadcastPending
	}
}

func (c *Chat) prepareChatMessage(msg *message.WSMessage) {
	if msg.MessageID == "" {
		messageID, err := uuid.NewRandom()
		if err != nil {
			log.Printf("error: chat: could not generate message id in chat %s: %v", c.ID, err)
		} else {
			msg.MessageID = messageID.String()
		}
	}

	if msg.MessageSeq == 0 {
		c.nextMessageSeq++
		msg.MessageSeq = c.nextMessageSeq
	}

	if msg.CreatedAt == nil {
		createdAt := time.Now().UTC()
		msg.CreatedAt = &createdAt
	}
}

func eventIDFromMessage(msg *message.WSMessage) (message.EventID, bool) {
	eventData, ok := msg.Data.(map[string]interface{})
	if !ok {
		return 0, false
	}

	eventID, ok := eventData["event_id"].(float64)
	if !ok {
		return 0, false
	}

	return message.EventID(eventID), true
}

func pushSubscriptionFromMessage(msg *message.WSMessage) (PushSubscription, bool) {
	eventData, ok := msg.Data.(map[string]interface{})
	if !ok {
		return PushSubscription{}, false
	}

	rawSubscription, ok := eventData["event_data"].(map[string]interface{})
	if !ok {
		return PushSubscription{}, false
	}

	endpoint, _ := rawSubscription["endpoint"].(string)
	rawKeys, _ := rawSubscription["keys"].(map[string]interface{})
	auth, _ := rawKeys["auth"].(string)
	p256dh, _ := rawKeys["p256dh"].(string)

	subscription := PushSubscription{
		Endpoint: endpoint,
		Keys: PushKeys{
			Auth:   auth,
			P256DH: p256dh,
		},
	}

	return subscription, subscription.Endpoint != "" &&
		subscription.Keys.Auth != "" &&
		subscription.Keys.P256DH != ""
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
