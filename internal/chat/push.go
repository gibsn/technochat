package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

const PushTTLSeconds = 24 * 60 * 60

var ErrPushSubscriptionGone = errors.New("push subscription expired or invalid")

type PushKeys struct {
	Auth   string `json:"auth"`
	P256DH string `json:"p256dh"`
}

type PushSubscription struct {
	Endpoint string   `json:"endpoint"`
	Keys     PushKeys `json:"keys"`
}

type PushPayload struct {
	ChatID     string      `json:"chatId"`
	MessageID  string      `json:"messageId"`
	MessageSeq uint64      `json:"messageSeq"`
	Sender     string      `json:"sender"`
	Data       interface{} `json:"data"`
	Timestamp  string      `json:"timestamp"`
}

type PushSender interface {
	Send(ctx context.Context, subscription PushSubscription, payload PushPayload) error
}

type NoopPushSender struct{}

func (NoopPushSender) Send(context.Context, PushSubscription, PushPayload) error {
	return nil
}

type VAPIDPushSender struct {
	PublicKey  string
	PrivateKey string
	Subject    string
	TTL        int
	HTTPClient webpush.HTTPClient
}

func NewVAPIDPushSender(publicKey, privateKey, subject string) *VAPIDPushSender {
	return &VAPIDPushSender{
		PublicKey:  publicKey,
		PrivateKey: privateKey,
		Subject:    subject,
		TTL:        PushTTLSeconds,
	}
}

func (s *VAPIDPushSender) Send(
	ctx context.Context,
	subscription PushSubscription,
	payload PushPayload,
) error {
	if s == nil || s.PublicKey == "" || s.PrivateKey == "" || s.Subject == "" {
		return nil
	}
	if subscription.Endpoint == "" || subscription.Keys.Auth == "" || subscription.Keys.P256DH == "" {
		return fmt.Errorf("invalid push subscription")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	response, err := webpush.SendNotificationWithContext(
		ctx,
		body,
		&webpush.Subscription{
			Endpoint: subscription.Endpoint,
			Keys: webpush.Keys{
				Auth:   subscription.Keys.Auth,
				P256dh: subscription.Keys.P256DH,
			},
		},
		&webpush.Options{
			HTTPClient:      s.HTTPClient,
			Subscriber:      s.Subject,
			TTL:             s.TTL,
			VAPIDPublicKey:  s.PublicKey,
			VAPIDPrivateKey: s.PrivateKey,
		},
	)
	if err != nil {
		return err
	}

	return handlePushResponse(response)
}

func handlePushResponse(response *http.Response) error {
	if response == nil {
		return nil
	}
	if _, err := io.Copy(io.Discard, response.Body); err != nil {
		_ = response.Body.Close()
		return err
	}
	if err := response.Body.Close(); err != nil {
		return err
	}

	if response.StatusCode == http.StatusGone || response.StatusCode == http.StatusNotFound {
		return ErrPushSubscriptionGone
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("push provider returned %s", response.Status)
	}

	return nil
}

func (c *Chat) UpsertPushSubscription(participantID int, subscription PushSubscription) bool {
	if subscription.Endpoint == "" || subscription.Keys.Auth == "" || subscription.Keys.P256DH == "" {
		return false
	}

	c.correspsMx.Lock()

	if _, ok := c.participantByID[participantID]; !ok {
		c.correspsMx.Unlock()
		return false
	}

	c.pushSubscriptions[participantID] = subscription
	chatParticipant, ok := c.participantStateLocked(participantID)
	c.correspsMx.Unlock()
	if !ok {
		return false
	}
	if c.store == nil {
		log.Printf(
			"info: chat: upserted push subscription chat=%s participant_id=%d",
			c.ID, participantID,
		)
		return true
	}

	if err := c.store.UpdateParticipant(
		c.ID,
		chatParticipant,
		int(c.offlineTTL.Seconds()),
	); err != nil {
		log.Printf(
			"error: chat: could not persist push subscription chat=%s participant_id=%d: %v",
			c.ID, participantID, err,
		)
		return false
	}

	log.Printf("info: chat: upserted push subscription chat=%s participant_id=%d", c.ID, participantID)

	return true
}

func (c *Chat) DeletePushSubscription(participantID int) {
	c.correspsMx.Lock()
	delete(c.pushSubscriptions, participantID)
	chatParticipant, ok := c.participantStateLocked(participantID)
	c.correspsMx.Unlock()
	if !ok {
		return
	}
	if c.store == nil {
		log.Printf(
			"info: chat: deleted push subscription chat=%s participant_id=%d",
			c.ID, participantID,
		)
		return
	}

	if err := c.store.UpdateParticipant(
		c.ID,
		chatParticipant,
		int(c.offlineTTL.Seconds()),
	); err != nil {
		log.Printf(
			"error: chat: could not persist push subscription delete chat=%s participant_id=%d: %v",
			c.ID, participantID, err,
		)
		return
	}

	log.Printf("info: chat: deleted push subscription chat=%s participant_id=%d", c.ID, participantID)
}

func (c *Chat) offlinePushTargets(senderID int) map[int]PushSubscription {
	c.correspsMx.RLock()
	defer c.correspsMx.RUnlock()

	targets := make(map[int]PushSubscription)
	for participantID, subscription := range c.pushSubscriptions {
		if participantID == senderID {
			continue
		}
		if _, online := c.corresps[participantID]; online {
			continue
		}

		targets[participantID] = subscription
	}

	return targets
}

func (c *Chat) sendPushToOfflineParticipants(senderID int, msg *messageForPush) {
	targets := c.offlinePushTargets(senderID)
	if len(targets) == 0 || c.pushSender == nil {
		return
	}

	for participantID, subscription := range targets {
		participantID := participantID
		subscription := subscription

		c.WG.Add(1)
		go func() {
			defer c.WG.Done()

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			err := c.pushSender.Send(ctx, subscription, PushPayload{
				ChatID:     c.ID,
				MessageID:  msg.MessageID,
				MessageSeq: msg.MessageSeq,
				Sender:     msg.Sender,
				Data:       msg.Data,
				Timestamp:  msg.Timestamp,
			})
			if err == nil {
				log.Printf(
					"info: chat: sent push chat=%s participant_id=%d message_id=%s message_seq=%d",
					c.ID, participantID, msg.MessageID, msg.MessageSeq,
				)
				return
			}

			if errors.Is(err, ErrPushSubscriptionGone) {
				c.correspsMx.Lock()
				delete(c.pushSubscriptions, participantID)
				chatParticipant, ok := c.participantStateLocked(participantID)
				c.correspsMx.Unlock()
				if ok && c.store != nil {
					err = c.store.UpdateParticipant(c.ID, chatParticipant, int(c.offlineTTL.Seconds()))
				} else {
					err = nil
				}
				if err != nil {
					log.Printf(
						"error: chat: could not persist expired push subscription removal chat=%s "+
							"participant_id=%d: %v",
						c.ID, participantID, err,
					)
				}
				log.Printf(
					"info: chat: removed expired push subscription chat=%s participant_id=%d",
					c.ID, participantID,
				)
				return
			}

			log.Printf(
				"error: chat: could not send push chat=%s participant_id=%d message_id=%s: %v",
				c.ID, participantID, msg.MessageID, err,
			)
		}()
	}
}

type messageForPush struct {
	MessageID  string
	MessageSeq uint64
	Sender     string
	Data       interface{}
	Timestamp  string
}
