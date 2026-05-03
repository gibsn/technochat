package entity

type Chat struct {
	ID           string
	MaxUsers     int
	RestJoins    int
	Participants []ChatParticipant
	TTL          int
}

type ChatParticipant struct {
	ID               int
	Name             string
	ReconnectToken   string
	PushSubscription *ChatPushSubscription
}

type ChatPushSubscription struct {
	Endpoint string       `json:"endpoint"`
	Keys     ChatPushKeys `json:"keys"`
}

type ChatPushKeys struct {
	Auth   string `json:"auth"`
	P256DH string `json:"p256dh"`
}
