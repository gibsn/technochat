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

func (u *User) reader() {
	q := make(chan *message.WSMessage)

	go func() {
		for {
			var msg message.WSMessage
			if err := u.ws.ReadJSON(&msg); err != nil {
				log.Printf("error: chat: could not read message from user [%d %s]: %v",
					u.ID, u.Name, err,
				)

				q <- nil
				return
			}

			q <- &msg
		}
	}()

	defer u.WG.Done()
	for {
		select {
		case <-u.shutdownChan:
			log.Printf("info: chat: closing reader goroutine for user [%d %s]", u.ID, u.Name)
			return

		case msg := <-q:
			if msg == nil {
				u.TriggerShutdown()
				continue
			}

			// TODO possible write after close
			u.read <- msg
		}
	}
}
