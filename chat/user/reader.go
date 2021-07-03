package user

import (
	"log"

	"technochat/chat/message"
)

const (
	userReadBufferSize = 10
)

func (u *User) ReadStream() <-chan *message.WSMessage {
	return u.read
}

func (u *User) doReadsFromWS(q chan *message.WSMessage) {
	for {
		var msg message.WSMessage
		if err := u.ws.ReadJSON(&msg); err != nil {
			log.Printf("error: chat: could not read message from user [%d %s]: %v",
				u.ID, u.Name, err,
			)

			close(q)

			return
		}

		q <- &msg
	}
}

func (u *User) reader() {
	defer u.WG.Done()

	q := make(chan *message.WSMessage)

	// reads from WS are done in a separate goroutine because ReadJSON blocks indefinitely
	// while we want to be able to react to the 'shutdown' event
	go u.doReadsFromWS(q)

	for {
		select {
		case <-u.shutdownChan:
			log.Printf("info: chat: closing reader goroutine for user [%d %s]", u.ID, u.Name)

			// by closing u.read exclusively in this goroutine we make sure no
			// one attempts to write to this channel
			close(u.read)

			return

		case msg, ok := <-q:
			if msg == nil || !ok {
				u.TriggerShutdown()
				continue
			}

			u.read <- msg
		}
	}
}
