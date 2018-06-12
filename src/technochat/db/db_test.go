package db

import (
	"testing"
)

func TestNewMessageID(t *testing.T) {
	messageID, err := NewMessageID()
	if err != nil {
		t.Error(err)
	}

	if len(messageID) == 0 {
		t.Error("empty messageID")
	}
}
