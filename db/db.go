package db

import "technochat/entity"

type DB interface {
	Init()
	Shutdown()

	AddMessage(message entity.Message) error
	GetMessage(messageID string) (entity.Message, error)
	DeleteMessage(messageID string) error
}
