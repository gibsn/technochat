package db

import "technochat/pkg/entity"

type DB interface {
	Init()
	Shutdown()

	AddMessage(message entity.Message) error
	GetMessage(messageID string) (entity.Message, error)
	DeleteMessage(messageID string) error

	AddImage(image entity.Image) error
	GetImage(imageID string) (entity.Image, error)
	DeleteImage(imageID string) error

	AddChat(chat entity.Chat) error
	UpdateChat(chat entity.Chat) error
	GetChat(chatID string) (entity.Chat, error)
	DeleteChat(chatID string) error
}
