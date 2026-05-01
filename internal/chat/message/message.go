package message

type TypeID int

const (
	WSMsgTypeService TypeID = iota
	WSMsgTypeMessage
)

type Event struct {
	EventID   EventID     `json:"event_id"`
	EventData interface{} `json:"event_data"`
}
type EventID int

const (
	EventConnInitOk EventID = iota
	EventConnInitNoSuchChat
	EventConnInitMaxUsrsReached
	EventPresence
)

type WSMessage struct {
	Type TypeID      `json:"type"`
	Data interface{} `json:"data"`
	Name string      `json:"username"`
}

type PresenceUser struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type Presence struct {
	Online int            `json:"online"`
	Max    int            `json:"max"`
	Users  []PresenceUser `json:"users"`
}
