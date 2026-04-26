package entity

import (
	"fmt"

	"github.com/google/uuid"
)

type Image struct {
	ID   string
	Body []byte
	TTL  int
}

func NewImageID() (string, error) {
	newUUID, err := uuid.NewRandom()
	if err != nil {
		return "", fmt.Errorf("could not generate imageID: %w", err)
	}

	return newUUID.String(), nil
}
