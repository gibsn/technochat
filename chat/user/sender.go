package user

import (
	"fmt"
	"log"
	"time"

	"github.com/gorilla/websocket"

	"technochat/chat/message"
)

const (
	userSendBufferSize = 10
)

const (
	pingPeriod  time.Duration = 30 * time.Second
	pingTimeout time.Duration = 1 * time.Second
)

func (u *User) SendMessage(msg *message.WSMessage) error {
	select {
	case u.send <- msg:
	default:
		return fmt.Errorf("queue is full")
	}

	return nil
}

func (u *User) SendEvent(event message.EventID, i interface{}) error {
	msg := &message.WSMessage{
		Type: message.WSMsgTypeService,
		Data: message.Event{
			EventID:   event,
			EventData: i,
		},
	}

	return u.SendMessage(msg)
}
func (u *User) sender() {
	defer u.WG.Done()

	pingTimer := time.NewTimer(pingPeriod)

	for {
		select {
		case <-u.shutdownChan:
			log.Printf("info: chat: closing sender goroutine for user [%d %s]", u.ID, u.Name)
			return

		case msg := <-u.send:
			if err := u.ws.WriteJSON(msg); err != nil {
				log.Printf("error: chat: could not send a message to user %s: %v", u.Name, err)
				u.TriggerShutdown()
			}

		case <-pingTimer.C:
			deadline := time.Now().Add(pingTimeout)

			if err := u.ws.WriteControl(websocket.PingMessage, nil, deadline); err != nil {
				log.Printf("error: chat: could not send a ping message to user %s: %v", u.Name, err)
				u.TriggerShutdown()

				continue
			}

			pingTimer = time.NewTimer(pingPeriod)
		}
	}
}
