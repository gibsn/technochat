package chat

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const ChatTTLEnv = "TECHNOCHAT_CHAT_TTL"

func OfflineTTLFromEnv() (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(ChatTTLEnv))
	if value == "" {
		return ChatOfflineTTL, nil
	}

	if seconds, err := strconv.Atoi(value); err == nil {
		ttl := time.Duration(seconds) * time.Second
		if ttl <= 0 {
			return 0, fmt.Errorf("%s must be positive", ChatTTLEnv)
		}

		return ttl, nil
	}

	ttl, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be a duration like 24h or a number of seconds: %w", ChatTTLEnv, err)
	}
	if ttl <= 0 {
		return 0, fmt.Errorf("%s must be positive", ChatTTLEnv)
	}

	return ttl, nil
}
