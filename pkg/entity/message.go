package entity

import (
	"fmt"

	"github.com/google/uuid"
)

func NewMessageID() (string, error) {
	newUUID, err := uuid.NewRandom()
	if err != nil {
		return "", fmt.Errorf("could not generate messageID: %w", err)
	}

	return newUUID.String(), nil
}

type Message struct {
	ID     string
	Text   string
	Images ImagesArray
	TTL    int
}
