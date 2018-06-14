package chat

import "github.com/gorilla/websocket"

type User struct {
	WS   *websocket.Conn
	Name string
	ID   int
}

func NewUser() *User {
	return &User{}
}

func (u *User) SendEvent(event EventID, i interface{}) {
	u.WS.WriteJSON(WSMessage{
		Type: WSMsgTypeService,
		Data: Event{event, i},
	})
}

func SendEvent(ws *websocket.Conn, event EventID, i interface{}) {
	ws.WriteJSON(WSMessage{
		Type: WSMsgTypeService,
		Data: Event{event, i},
	})
}
