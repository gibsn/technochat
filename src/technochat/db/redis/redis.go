package redis

import (
	"fmt"
	// "github.com/mediocregopher/radix.v2"
)

type Redis struct {
}

func (r *Redis) AddMessage(message string) (string, error) {
	return "", fmt.Errorf("not implemented")
}

func (r *Redis) GetMessage(messageID string) (string, error) {
	return "", fmt.Errorf("not implemented")
}

func (r *Redis) DeleteMessage(messageID string) error {
	return fmt.Errorf("not implemented")
}
