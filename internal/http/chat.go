package http

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"technochat/internal/chat"
	"technochat/internal/chat/message"
	"technochat/internal/chat/user"
)

type ChatInitRequest struct {
	MaxUsers int `json:"max_users,string"`
}

type ChatInitResponse struct {
	ID string `json:"id"`
}

func (s *Server) chatInit(r *http.Request) (int, interface{}, error) {
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		return http.StatusBadRequest, nil, err
	}

	req := ChatInitRequest{MaxUsers: chat.DefaultMaxPeople}
	err = json.Unmarshal(body, &req)
	if err != nil {
		return http.StatusBadRequest, nil, err
	}

	if req.MaxUsers < chat.MinPeopleInChat {
		return http.StatusBadRequest, nil, err
	}
	if req.MaxUsers > chat.MaxPeopleInChat {
		return http.StatusBadRequest, nil, err
	}

	chatID, err := uuid.NewRandom()
	if err != nil {
		return http.StatusInternalServerError, nil, err
	}

	newChat := chat.NewChat(chat.NewChatOpts{
		ID:       chatID.String(),
		MaxJoins: req.MaxUsers,
		Store:    s.db,
	})

	if err := s.db.AddChat(newChat.State()); err != nil {
		return http.StatusInternalServerError, nil, err
	}

	s.startChat(newChat)
	log.Printf("info: chat: started a new chat %s for %d people", newChat.ID, newChat.RestJoins())

	resp := ChatInitResponse{
		ID: newChat.ID,
	}

	return http.StatusOK, resp, nil
}

func (s *Server) restoreChats() error {
	savedChats, err := s.db.GetChats()
	if err != nil {
		return err
	}

	for _, savedChat := range savedChats {
		participants := make([]chat.Participant, 0, len(savedChat.Participants))
		for _, participant := range savedChat.Participants {
			participants = append(participants, chat.Participant{
				ID:             participant.ID,
				Name:           participant.Name,
				ReconnectToken: participant.ReconnectToken,
			})
		}

		restoredChat := chat.NewChat(chat.NewChatOpts{
			ID:               savedChat.ID,
			MaxJoins:         savedChat.MaxUsers,
			RestJoins:        savedChat.RestJoins,
			RestoreRestJoins: true,
			Participants:     participants,
			Store:            s.db,
		})

		s.startChat(restoredChat)
		log.Printf("info: chat: restored chat %s for %d people, joins left: %d",
			restoredChat.ID, savedChat.MaxUsers, restoredChat.RestJoins())
	}

	return nil
}

func (s *Server) startChat(c *chat.Chat) {
	chat.AddChat(c)

	go func() {
		chat.HandleChat(c)

		if err := s.db.DeleteChat(c.ID); err != nil {
			log.Printf("error: chat: could not delete chat %s from db: %v", c.ID, err)
		}
	}()
}

func (s *Server) chatConnect(w http.ResponseWriter, r *http.Request) {
	s.chatConnectWithMode(w, r, false)
}

func (s *Server) chatReconnect(w http.ResponseWriter, r *http.Request) {
	s.chatConnectWithMode(w, r, true)
}

func (s *Server) chatConnectWithMode(w http.ResponseWriter, r *http.Request, reconnect bool) {
	ws, err := chat.Upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("error: chat: error upgrading chat connection: %v", err)
		return
	}
	defer ws.Close()

	if err = r.ParseForm(); err != nil {
		log.Printf("error: chat: could not parse form: %v", err)
		return
	}

	chatIDStr := r.FormValue("id")
	remoteAddr := getRealRemoteAddr(r)

	c := chat.GetChat(chatIDStr)
	if c == nil {
		log.Printf("info: chat: chat %s does not exist for %s", chatIDStr, remoteAddr)
		sendChatInitEvent(ws, message.EventConnInitNoSuchChat)
		return
	}

	usr, err := connectChatUser(c, ws, r, reconnect)
	if err != nil {
		level := "error"
		eventID := message.EventConnInitNoSuchChat

		if err == chat.ErrInvitationQuotaExceeded {
			level = "warning"
			eventID = message.EventConnInitMaxUsrsReached
		}
		if err == chat.ErrInvalidReconnectToken {
			level = "warning"
			eventID = message.EventConnInitInvalidReconnectToken
		}

		log.Printf("%s: chat: could not add new user to chat %s: %v", level, chatIDStr, err)
		sendChatInitEvent(ws, eventID)
		return
	}

	log.Printf("info: chat: connected user [%d %s] to chat %s from %s, joins left after add: %d",
		usr.ID, usr.Name, chatIDStr, remoteAddr, c.RestJoins())

	usr.Routine()

	c.DelUser(usr)
}

func connectChatUser(
	c *chat.Chat,
	ws *websocket.Conn,
	r *http.Request,
	reconnect bool,
) (*user.User, error) {
	if reconnect {
		return c.ReconnectUser(ws, r.FormValue("reconnect_token"))
	}

	return c.AddUser(ws)
}

func sendChatInitEvent(ws *websocket.Conn, eventID message.EventID) {
	if err := ws.WriteJSON(message.WSMessage{
		Type: message.WSMsgTypeService,
		Data: message.Event{
			EventID: eventID,
		},
	}); err != nil {
		log.Printf("error: chat: could not send init event %d: %v", eventID, err)
	}
}
