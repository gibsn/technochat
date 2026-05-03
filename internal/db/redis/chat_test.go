package redis

import (
	"encoding/json"
	"testing"

	"technochat/pkg/entity"
)

func TestNewChatFromRedisRestoresParticipants(t *testing.T) {
	participants := []entity.ChatParticipant{
		{
			ID:             42,
			Name:           "restored user",
			ReconnectToken: "reconnect-token",
		},
	}
	participantsJSON, err := json.Marshal(participants)
	if err != nil {
		t.Fatalf("could not marshal participants: %v", err)
	}

	chat, err := newChatFromRedis("chat-id", map[string]string{
		chatMaxUsersKey:     "3",
		chatRestJoinsKey:    "2",
		chatParticipantsKey: string(participantsJSON),
	})
	if err != nil {
		t.Fatalf("could not restore chat: %v", err)
	}

	if chat.ID != "chat-id" {
		t.Fatalf("expected chat id to be restored, got %q", chat.ID)
	}
	if chat.MaxUsers != 3 {
		t.Fatalf("expected max users 3, got %d", chat.MaxUsers)
	}
	if chat.RestJoins != 2 {
		t.Fatalf("expected rest joins 2, got %d", chat.RestJoins)
	}
	if len(chat.Participants) != 1 {
		t.Fatalf("expected 1 participant, got %d", len(chat.Participants))
	}
	if chat.Participants[0] != participants[0] {
		t.Fatalf("expected participant %#v, got %#v", participants[0], chat.Participants[0])
	}
}

func TestNewChatFromRedisRestoresPushSubscriptions(t *testing.T) {
	pushSubscriptions := []entity.ChatPushSubscription{
		{
			ParticipantID: 42,
			Endpoint:      "https://push.example/subscription",
			Keys: entity.ChatPushKeys{
				Auth:   "auth-secret",
				P256DH: "p256dh-key",
			},
		},
	}
	pushSubscriptionsJSON, err := json.Marshal(pushSubscriptions)
	if err != nil {
		t.Fatalf("could not marshal push subscriptions: %v", err)
	}

	chat, err := newChatFromRedis("chat-id", map[string]string{
		chatMaxUsersKey:          "3",
		chatRestJoinsKey:         "2",
		chatPushSubscriptionsKey: string(pushSubscriptionsJSON),
	})
	if err != nil {
		t.Fatalf("could not restore chat: %v", err)
	}

	if len(chat.PushSubscriptions) != 1 {
		t.Fatalf("expected 1 push subscription, got %d", len(chat.PushSubscriptions))
	}
	if chat.PushSubscriptions[0] != pushSubscriptions[0] {
		t.Fatalf(
			"expected push subscription %#v, got %#v",
			pushSubscriptions[0],
			chat.PushSubscriptions[0],
		)
	}
}
