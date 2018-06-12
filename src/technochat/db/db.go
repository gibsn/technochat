package db

import (
	"fmt"

	"github.com/google/uuid"
)

type DB interface {
	Init()
	Shutdown()

	AddMessage(messageID, message string) error
	GetMessage(messageID string) (string, error)
	DeleteMessage(messageID string) error
}

func NewMessageID() (string, error) {
	newUUID, err := uuid.NewRandom()
	if err != nil {
		return "", fmt.Errorf("could not generate messageID: %s", err)
	}

	return newUUID.String(), nil
}
