package entity

type Chat struct {
	ID           string
	MaxUsers     int
	RestJoins    int
	Participants []ChatParticipant
	TTL          int
}

type ChatParticipant struct {
	ID             int
	Name           string
	ReconnectToken string
}
