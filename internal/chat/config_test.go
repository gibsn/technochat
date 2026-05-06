package chat

import (
	"testing"
	"time"
)

func TestOfflineTTLFromEnvUsesDefaultWhenUnset(t *testing.T) {
	t.Setenv(ChatTTLEnv, "")

	ttl, err := OfflineTTLFromEnv()
	if err != nil {
		t.Fatalf("expected unset %s to be valid: %v", ChatTTLEnv, err)
	}
	if ttl != ChatOfflineTTL {
		t.Fatalf("expected default TTL %s, got %s", ChatOfflineTTL, ttl)
	}
}

func TestOfflineTTLFromEnvParsesDuration(t *testing.T) {
	t.Setenv(ChatTTLEnv, "2h30m")

	ttl, err := OfflineTTLFromEnv()
	if err != nil {
		t.Fatalf("expected duration %s to be valid: %v", ChatTTLEnv, err)
	}
	if ttl != 150*time.Minute {
		t.Fatalf("expected TTL %s, got %s", 150*time.Minute, ttl)
	}
}

func TestOfflineTTLFromEnvParsesSeconds(t *testing.T) {
	t.Setenv(ChatTTLEnv, "90")

	ttl, err := OfflineTTLFromEnv()
	if err != nil {
		t.Fatalf("expected seconds %s to be valid: %v", ChatTTLEnv, err)
	}
	if ttl != 90*time.Second {
		t.Fatalf("expected TTL %s, got %s", 90*time.Second, ttl)
	}
}

func TestOfflineTTLFromEnvRejectsInvalidValue(t *testing.T) {
	t.Setenv(ChatTTLEnv, "forever")

	if _, err := OfflineTTLFromEnv(); err == nil {
		t.Fatalf("expected invalid %s to fail", ChatTTLEnv)
	}
}
