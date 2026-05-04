//go:build integration_tests
// +build integration_tests

package redis

import (
	"os"
	"testing"
	"time"

	"technochat/pkg/entity"
)

func TestChatTTLIsSetRefreshedAndExpires(t *testing.T) {
	addr := os.Getenv("TECHNOCHAT_TEST_REDIS_ADDR")
	if addr == "" {
		t.Skip("TECHNOCHAT_TEST_REDIS_ADDR is not set")
	}

	r := NewRedis(addr)
	r.Init()
	defer r.pool.Empty()

	chatID := "ttl-integration-test"
	key := newChatKey(chatID)
	if err := r.pool.Cmd("DEL", key).Err; err != nil {
		t.Fatalf("could not cleanup chat key before test: %v", err)
	}
	defer r.pool.Cmd("DEL", key)

	chat := entity.Chat{
		ID:        chatID,
		MaxUsers:  2,
		RestJoins: 2,
		TTL:       3,
	}
	if err := r.AddChat(chat); err != nil {
		t.Fatalf("could not add chat: %v", err)
	}

	initialTTL := redisTTL(t, r, key)
	if initialTTL <= 0 {
		t.Fatalf("expected positive chat TTL, got %d", initialTTL)
	}

	time.Sleep(1500 * time.Millisecond)

	if err := r.TouchChat(chat.ID, chat.TTL); err != nil {
		t.Fatalf("could not touch chat: %v", err)
	}

	refreshedTTL := redisTTL(t, r, key)
	if refreshedTTL < 2 {
		t.Fatalf("expected refreshed chat TTL to be at least 2 seconds, got %d", refreshedTTL)
	}

	time.Sleep(2 * time.Second)

	if exists := redisExists(t, r, key); !exists {
		t.Fatalf("expected chat key to exist after TTL refresh")
	}

	waitForRedisKeyMissing(t, r, key)
}

func redisTTL(t *testing.T, r *Redis, key string) int {
	t.Helper()

	ttl, err := r.pool.Cmd("TTL", key).Int()
	if err != nil {
		t.Fatalf("could not read TTL for %s: %v", key, err)
	}

	return ttl
}

func redisExists(t *testing.T, r *Redis, key string) bool {
	t.Helper()

	exists, err := r.pool.Cmd("EXISTS", key).Int()
	if err != nil {
		t.Fatalf("could not check key %s existence: %v", key, err)
	}

	return exists == 1
}

func waitForRedisKeyMissing(t *testing.T, r *Redis, key string) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if !redisExists(t, r, key) {
			return
		}

		time.Sleep(100 * time.Millisecond)
	}

	t.Fatalf("expected chat key %s to expire", key)
}
