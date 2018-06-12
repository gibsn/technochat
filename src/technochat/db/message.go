package db

type DB interface {
	Init()

	AddMessage(messageID, message string) error
	GetMessage(messageID string) (string, error)
	DeleteMessage(messageID string) error
}

// TODO
func NewMessageID() string {
}
