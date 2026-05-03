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
	AddParticipant(chatID string, participant entity.ChatParticipant, restJoins int, ttl int) error
	UpdateParticipant(chatID string, participant entity.ChatParticipant, ttl int) error
	TouchChat(chatID string, ttl int) error
	GetChat(chatID string) (entity.Chat, error)
	DeleteChat(chatID string) error
}
