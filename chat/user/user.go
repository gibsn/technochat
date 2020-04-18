package user

import (
	"log"
	"sync"

	"github.com/gorilla/websocket"

	"technochat/chat/message"
)

type User struct {
	ID   int
	Name string

	ws *websocket.Conn

	read chan *message.WSMessage
	send chan *message.WSMessage

	triggerShutdownOnce sync.Once
	triggerShutdownChan chan struct{}
	shutdownChan        chan struct{}

	WG sync.WaitGroup
}

func NewUser(ws *websocket.Conn) *User {
	usr := &User{
		ws:                  ws,
		read:                make(chan *message.WSMessage, userReadBufferSize),
		send:                make(chan *message.WSMessage, userSendBufferSize),
		triggerShutdownChan: make(chan struct{}),
		shutdownChan:        make(chan struct{}),
	}

	usr.WG.Add(2)
	go usr.reader()
	go usr.sender()

	return usr
}

func (u *User) TriggerShutdown() {
	u.triggerShutdownOnce.Do(func() {
		close(u.read)
		close(u.triggerShutdownChan)
	})
}

func (u *User) Routine() {
	select {
	case <-u.triggerShutdownChan:
		log.Printf("info: chat: triggered shutdown for user [%d %s]", u.ID, u.Name)
	}

	close(u.shutdownChan)
	u.WG.Wait()
	u.ws.Close()
}
