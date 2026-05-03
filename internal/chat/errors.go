package chat

import (
	"errors"
)

var (
	ErrInvitationQuotaExceeded = errors.New("invitation quota exceeded")
	ErrInvalidReconnectToken   = errors.New("invalid reconnect token")
)
