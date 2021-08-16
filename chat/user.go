package chat

import (
	"log"

	"github.com/gorilla/websocket"

	"technochat/chat/user"
)

func (c *Chat) AddUser(ws *websocket.Conn) (*user.User, error) {
	c.correspsMx.Lock()
	if c.restJoins <= 0 {
		c.correspsMx.Unlock()
		return nil, ErrInvitationQuotaExceeded
	}

	c.restJoins--
	c.correspsMx.Unlock()

	usr := user.NewUser(ws)
	usr.Name, usr.ID = c.ChatNames.GenerateNameID()

	log.Printf("info: chat: new user [%d %s] in chat %s", usr.ID, usr.Name, c.ID)

	c.correspsMx.Lock()
	c.corresps[usr.ID] = usr
	c.correspsMx.Unlock()

	c.usersWG.Add(1)
	c.userConnectedChan <- usr

	return usr, nil
}

func (c *Chat) DelUser(id int) {
	c.correspsMx.Lock()

	usr, ok := c.corresps[id]
	if !ok {
		c.correspsMx.Unlock()
		return
	}

	log.Printf("info: chat: deleting user [%d, %s] in chat %s", usr.ID, usr.Name, c.ID)

	delete(c.corresps, id)
	c.correspsMx.Unlock()

	c.userDisconnectedChan <- usr
	c.usersWG.Done()
}

func (c *Chat) SubscribeUser(usr *user.User) {
	go func() {
		for msg := range usr.ReadStream() {
			msg.Name = usr.Name
			c.incomingChan <- msg
		}
	}()
}

func (c *Chat) ShutdownUsers() {
	c.correspsMx.Lock()
	for _, usr := range c.corresps {
		usr.TriggerShutdown()
	}
	c.correspsMx.Unlock()

	c.usersWG.Wait()
}
