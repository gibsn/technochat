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
			PushSubscription: &entity.ChatPushSubscription{
				Endpoint: "https://push.example/subscription",
				Keys: entity.ChatPushKeys{
					Auth:   "auth-secret",
					P256DH: "p256dh-key",
				},
			},
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
	if chat.Participants[0].ID != participants[0].ID ||
		chat.Participants[0].Name != participants[0].Name ||
		chat.Participants[0].ReconnectToken != participants[0].ReconnectToken {
		t.Fatalf("expected participant %#v, got %#v", participants[0], chat.Participants[0])
	}
	if chat.Participants[0].PushSubscription == nil {
		t.Fatalf("expected participant push subscription to be restored")
	}
	if *chat.Participants[0].PushSubscription != *participants[0].PushSubscription {
		t.Fatalf(
			"expected push subscription %#v, got %#v",
			participants[0].PushSubscription,
			chat.Participants[0].PushSubscription,
		)
	}
}
