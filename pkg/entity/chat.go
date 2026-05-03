package entity

type Chat struct {
	ID                string
	MaxUsers          int
	RestJoins         int
	Participants      []ChatParticipant
	PushSubscriptions []ChatPushSubscription
	TTL               int
}

type ChatParticipant struct {
	ID             int
	Name           string
	ReconnectToken string
}

type ChatPushSubscription struct {
	ParticipantID int          `json:"participant_id"`
	Endpoint      string       `json:"endpoint"`
	Keys          ChatPushKeys `json:"keys"`
}

type ChatPushKeys struct {
	Auth   string `json:"auth"`
	P256DH string `json:"p256dh"`
}
