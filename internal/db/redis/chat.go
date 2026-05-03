package redis

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/mediocregopher/radix.v2/redis"

	"technochat/pkg/entity"
)

const (
	addChatParticipantScript = `
if redis.call("EXISTS", KEYS[1]) == 0 then
	return redis.error_reply("chat not found")
end
redis.call("HSET", KEYS[1], ARGV[1], ARGV[2])
redis.call("HSET", KEYS[1], ARGV[3], ARGV[4])
return redis.call("EXPIRE", KEYS[1], ARGV[5])
`
	updateChatParticipantScript = `
if redis.call("EXISTS", KEYS[1]) == 0 then
	return redis.error_reply("chat not found")
end
redis.call("HSET", KEYS[1], ARGV[1], ARGV[2])
return redis.call("EXPIRE", KEYS[1], ARGV[3])
`
)

func newChatKey(id string) string {
	return fmt.Sprintf("%s:%s", chatKeyPrefix, id)
}

func newChatParticipantKey(participantID int) string {
	return fmt.Sprintf("%s%d", chatParticipantKey, participantID)
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

	participants, err := chatParticipantsFromRedis(id, redisResp)
	if err != nil {
		return entity.Chat{}, err
	}

	return entity.Chat{
		ID:           id,
		MaxUsers:     maxUsers,
		RestJoins:    restJoins,
		Participants: participants,
	}, nil
}

func chatParticipantsFromRedis(
	chatID string,
	redisResp map[string]string,
) ([]entity.ChatParticipant, error) {
	participants := make([]entity.ChatParticipant, 0)
	for key, value := range redisResp {
		if !strings.HasPrefix(key, chatParticipantKey) {
			continue
		}

		var participant entity.ChatParticipant
		if err := json.Unmarshal([]byte(value), &participant); err != nil {
			return nil, fmt.Errorf("invalid chat %s: participant %s is invalid: %w", chatID, key, err)
		}
		participants = append(participants, participant)
	}

	if len(participants) == 0 {
		if participantsJSON := redisResp[chatParticipantsKey]; participantsJSON != "" {
			if err := json.Unmarshal([]byte(participantsJSON), &participants); err != nil {
				return nil, fmt.Errorf("invalid chat %s: participants are invalid: %w", chatID, err)
			}
		}
	}

	sort.Slice(participants, func(i, j int) bool {
		return participants[i].ID < participants[j].ID
	})

	return participants, nil
}

func (r *Redis) saveChat(chat entity.Chat) error {
	if chat.ID == "" {
		return fmt.Errorf("could not save chat: id is missing")
	}
	if chat.TTL <= 0 {
		return fmt.Errorf("could not save chat %s: TTL must be positive", chat.ID)
	}

	key := newChatKey(chat.ID)
	if err := r.pool.Cmd(
		"HMSET", key,
		chatMaxUsersKey, chat.MaxUsers,
		chatRestJoinsKey, chat.RestJoins,
	).Err; err != nil {
		return fmt.Errorf("could not save chat %s: %w", chat.ID, err)
	}
	if err := r.pool.Cmd("HDEL", key, chatParticipantsKey).Err; err != nil {
		return fmt.Errorf("could not cleanup chat %s legacy participants: %w", chat.ID, err)
	}
	for _, participant := range chat.Participants {
		if err := r.saveParticipant(key, chat.ID, participant); err != nil {
			return err
		}
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

func (r *Redis) AddParticipant(
	chatID string,
	participant entity.ChatParticipant,
	restJoins int,
	ttl int,
) error {
	if restJoins < 0 {
		return fmt.Errorf("could not add participant to chat %s: rest_joins is negative", chatID)
	}
	if ttl <= 0 {
		return fmt.Errorf("could not add participant to chat %s: TTL must be positive", chatID)
	}
	participantJSON, err := marshalChatParticipant(chatID, participant)
	if err != nil {
		return err
	}
	if err := r.pool.Cmd(
		"EVAL",
		addChatParticipantScript,
		1,
		newChatKey(chatID),
		newChatParticipantKey(participant.ID),
		participantJSON,
		chatRestJoinsKey,
		restJoins,
		ttl,
	).Err; err != nil {
		return fmt.Errorf("could not add participant %d to chat %s: %w", participant.ID, chatID, err)
	}

	return nil
}

func (r *Redis) UpdateParticipant(
	chatID string,
	participant entity.ChatParticipant,
	ttl int,
) error {
	if ttl <= 0 {
		return fmt.Errorf("could not update participant in chat %s: TTL must be positive", chatID)
	}
	participantJSON, err := marshalChatParticipant(chatID, participant)
	if err != nil {
		return err
	}
	if err := r.pool.Cmd(
		"EVAL",
		updateChatParticipantScript,
		1,
		newChatKey(chatID),
		newChatParticipantKey(participant.ID),
		participantJSON,
		ttl,
	).Err; err != nil {
		return fmt.Errorf("could not update chat %s participant %d: %w", chatID, participant.ID, err)
	}

	return nil
}

func (r *Redis) saveParticipant(
	key string,
	chatID string,
	participant entity.ChatParticipant,
) error {
	participantJSON, err := marshalChatParticipant(chatID, participant)
	if err != nil {
		return err
	}
	if err := r.pool.Cmd(
		"HSET",
		key,
		newChatParticipantKey(participant.ID),
		participantJSON,
	).Err; err != nil {
		return fmt.Errorf("could not save chat %s participant %d: %w", chatID, participant.ID, err)
	}

	return nil
}

func marshalChatParticipant(chatID string, participant entity.ChatParticipant) (string, error) {
	if participant.ID < 0 {
		return "", fmt.Errorf("could not save chat %s participant: id must be non-negative", chatID)
	}

	participantJSON, err := json.Marshal(participant)
	if err != nil {
		return "", fmt.Errorf("could not marshal chat %s participant %d: %w", chatID, participant.ID, err)
	}

	return string(participantJSON), nil
}

func (r *Redis) TouchChat(chatID string, ttl int) error {
	if ttl <= 0 {
		return fmt.Errorf("could not touch chat %s: TTL must be positive", chatID)
	}
	touched, err := r.pool.Cmd("EXPIRE", newChatKey(chatID), ttl).Int()
	if err != nil {
		return fmt.Errorf("could not touch chat %s: %w", chatID, err)
	}
	if touched == 0 {
		return entity.ErrNotFound
	}

	return nil
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
