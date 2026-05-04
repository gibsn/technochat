package chat

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"time"

	"github.com/gorilla/websocket"

	"technochat/internal/chat/user"
)

func (c *Chat) AddUser(ws *websocket.Conn) (*user.User, error) {
	c.correspsMx.Lock()
	if c.restJoins <= 0 {
		c.correspsMx.Unlock()
		return nil, ErrInvitationQuotaExceeded
	}

	participant, err := c.newParticipant()
	if err != nil {
		c.correspsMx.Unlock()
		return nil, err
	}

	c.restJoins--
	if c.store != nil {
		chatParticipant, ok := c.participantStateLocked(participant.ID)
		if !ok {
			c.restJoins++
			delete(c.participants, participant.ReconnectToken)
			delete(c.participantByID, participant.ID)
			c.correspsMx.Unlock()

			return nil, fmt.Errorf("could not persist chat state: participant is missing")
		}
		if err := c.store.AddParticipant(
			c.ID,
			chatParticipant,
			c.restJoins,
			int(c.offlineTTL.Seconds()),
		); err != nil {
			c.restJoins++
			delete(c.participants, participant.ReconnectToken)
			delete(c.participantByID, participant.ID)
			c.correspsMx.Unlock()

			return nil, fmt.Errorf("could not persist chat state: %w", err)
		}
	}
	c.correspsMx.Unlock()

	return c.connectParticipant(ws, participant), nil
}

func (c *Chat) ReconnectUser(ws *websocket.Conn, reconnectToken string) (*user.User, error) {
	c.correspsMx.RLock()
	participant, ok := c.participants[reconnectToken]
	c.correspsMx.RUnlock()
	if !ok {
		return nil, ErrInvalidReconnectToken
	}
	if err := c.touchState(); err != nil {
		return nil, fmt.Errorf("could not persist chat state: %w", err)
	}

	return c.connectParticipant(ws, participant), nil
}

func (c *Chat) newParticipant() (*Participant, error) {
	name, id := c.ChatNames.GenerateNameID()
	token, err := newReconnectToken()
	if err != nil {
		return nil, err
	}

	participant := &Participant{
		ID:             id,
		Name:           name,
		ReconnectToken: token,
	}
	c.participants[token] = participant
	c.participantByID[participant.ID] = participant

	log.Printf(
		"info: chat: new participant [%d %s] in chat %s",
		participant.ID, participant.Name, c.ID,
	)

	return participant, nil
}

func (c *Chat) connectParticipant(ws *websocket.Conn, participant *Participant) *user.User {
	usr := user.NewUser(ws)
	usr.Name = participant.Name
	usr.ID = participant.ID
	usr.ReconnectToken = participant.ReconnectToken

	log.Printf("info: chat: connecting user [%d %s] in chat %s", usr.ID, usr.Name, c.ID)

	c.correspsMx.Lock()
	if prevUser, ok := c.corresps[usr.ID]; ok {
		prevUser.TriggerShutdown()
	}
	c.corresps[usr.ID] = usr
	c.correspsMx.Unlock()

	c.usersWG.Add(1)
	c.userConnectedChan <- usr

	return usr
}

func (c *Chat) DelUser(usr *user.User) {
	c.correspsMx.Lock()

	onlineUser, ok := c.corresps[usr.ID]
	if !ok || onlineUser != usr {
		c.correspsMx.Unlock()
		c.usersWG.Done()
		return
	}

	log.Printf("info: chat: deleting user [%d, %s] in chat %s", usr.ID, usr.Name, c.ID)

	delete(c.corresps, usr.ID)
	c.correspsMx.Unlock()

	c.userDisconnectedChan <- usr
	c.usersWG.Done()
}

func (c *Chat) SubscribeUser(usr *user.User) {
	go func() {
		for msg := range usr.ReadStream() {
			createdAt := time.Now().UTC()
			msg.Name = usr.Name
			msg.CreatedAt = &createdAt
			c.incomingChan <- &incomingMessage{
				user: usr,
				msg:  msg,
			}
		}
	}()
}

func newReconnectToken() (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(tokenBytes), nil
}

func (c *Chat) ShutdownUsers() {
	c.correspsMx.Lock()
	for _, usr := range c.corresps {
		usr.TriggerShutdown()
	}
	c.correspsMx.Unlock()

	c.usersWG.Wait()
}
