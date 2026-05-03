package redis

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/mediocregopher/radix.v2/redis"

	"technochat/pkg/entity"
)

func newChatKey(id string) string {
	return fmt.Sprintf("%s:%s", chatKeyPrefix, id)
}

func newChatFromRedis(id string, redisResp map[string]string) (entity.Chat, error) {
	maxUsers, err := strconv.Atoi(redisResp[chatMaxUsersKey])
	if err != nil {
		return entity.Chat{}, fmt.Errorf("invalid chat: max_users is invalid: %w", err)
	}

	restJoins, err := strconv.Atoi(redisResp[chatRestJoinsKey])
	if err != nil {
		return entity.Chat{}, fmt.Errorf("invalid chat: rest_joins is invalid: %w", err)
	}

	if id == "" {
		return entity.Chat{}, fmt.Errorf("invalid chat: id is missing")
	}
	if maxUsers < 0 {
		return entity.Chat{}, fmt.Errorf("invalid chat %s: max_users is negative", id)
	}
	if restJoins < 0 {
		return entity.Chat{}, fmt.Errorf("invalid chat %s: rest_joins is negative", id)
	}
	if restJoins > maxUsers {
		return entity.Chat{}, fmt.Errorf("invalid chat %s: rest_joins exceeds max_users", id)
	}

	participants := []entity.ChatParticipant{}
	if participantsJSON := redisResp[chatParticipantsKey]; participantsJSON != "" {
		if err := json.Unmarshal([]byte(participantsJSON), &participants); err != nil {
			return entity.Chat{}, fmt.Errorf("invalid chat %s: participants are invalid: %w", id, err)
		}
	}

	pushSubscriptions := []entity.ChatPushSubscription{}
	if pushSubscriptionsJSON := redisResp[chatPushSubscriptionsKey]; pushSubscriptionsJSON != "" {
		if err := json.Unmarshal([]byte(pushSubscriptionsJSON), &pushSubscriptions); err != nil {
			return entity.Chat{}, fmt.Errorf("invalid chat %s: push subscriptions are invalid: %w", id, err)
		}
	}

	return entity.Chat{
		ID:                id,
		MaxUsers:          maxUsers,
		RestJoins:         restJoins,
		Participants:      participants,
		PushSubscriptions: pushSubscriptions,
	}, nil
}

func (r *Redis) saveChat(chat entity.Chat) error {
	if chat.ID == "" {
		return fmt.Errorf("could not save chat: id is missing")
	}
	if chat.TTL <= 0 {
		return fmt.Errorf("could not save chat %s: TTL must be positive", chat.ID)
	}

	key := newChatKey(chat.ID)
	participantsJSON, err := json.Marshal(chat.Participants)
	if err != nil {
		return fmt.Errorf("could not marshal chat %s participants: %w", chat.ID, err)
	}
	pushSubscriptionsJSON, err := json.Marshal(chat.PushSubscriptions)
	if err != nil {
		return fmt.Errorf("could not marshal chat %s push subscriptions: %w", chat.ID, err)
	}

	if err := r.pool.Cmd(
		"HMSET", key,
		chatMaxUsersKey, chat.MaxUsers,
		chatRestJoinsKey, chat.RestJoins,
		chatParticipantsKey, string(participantsJSON),
		chatPushSubscriptionsKey, string(pushSubscriptionsJSON),
	).Err; err != nil {
		return fmt.Errorf("could not save chat %s: %w", chat.ID, err)
	}

	if err := r.pool.Cmd("EXPIRE", key, chat.TTL).Err; err != nil {
		if delErr := r.pool.Cmd("DEL", key).Err; delErr != nil {
			return fmt.Errorf("could not set TTL for chat %s and cleanup failed: %w", chat.ID, delErr)
		}

		return fmt.Errorf("could not set TTL for chat %s: %w", chat.ID, err)
	}

	return nil
}

func (r *Redis) AddChat(chat entity.Chat) error {
	return r.saveChat(chat)
}

func (r *Redis) UpdateChat(chat entity.Chat) error {
	return r.saveChat(chat)
}

func (r *Redis) GetChat(chatID string) (entity.Chat, error) {
	key := newChatKey(chatID)

	resp := r.pool.Cmd("HGETALL", key)
	if err := resp.Err; err != nil {
		if err == redis.ErrRespNil {
			return entity.Chat{}, entity.ErrNotFound
		}

		return entity.Chat{}, fmt.Errorf("could not get chat %s: %w", chatID, err)
	}

	chatMap, err := resp.Map()
	if err != nil {
		return entity.Chat{}, fmt.Errorf("could not parse chat %s: %w", chatID, err)
	}
	if len(chatMap) == 0 {
		return entity.Chat{}, entity.ErrNotFound
	}

	return newChatFromRedis(chatID, chatMap)
}

func (r *Redis) DeleteChat(chatID string) error {
	key := newChatKey(chatID)

	if err := r.pool.Cmd("DEL", key).Err; err != nil {
		if err == redis.ErrRespNil {
			return entity.ErrNotFound
		}

		return fmt.Errorf("could not delete chat with ID %s: %w", chatID, err)
	}

	return nil
}
