package db

import "technochat/entity"

type DB interface {
	Init()
	Shutdown()

	AddMessage(message entity.Message) error
	GetMessage(messageID string) (entity.Message, error)
	DeleteMessage(messageID string) error

	AddImage(image entity.Image) error
	GetImage(imageID string) (entity.Image, error)
	DeleteImage(imageID string) error
}
