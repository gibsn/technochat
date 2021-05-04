package chat

import (
	"errors"
)

var (
	ErrInvitationQuotaExceeded = errors.New("invitation quota exceeded")
)
