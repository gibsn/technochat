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
		ID:         chatID.String(),
		MaxJoins:   req.MaxUsers,
		OfflineTTL: s.chatOfflineTTL,
		Store:      s.db,
		PushSender: s.pushSender,
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

func (s *Server) startChat(c *chat.Chat) {
	s.chatRegistry().AddChat(c)
	go s.chatRegistry().HandleChat(c)
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
	chatIDForLog := sanitizeClientLogValue(chatIDStr)
	remoteAddrForLog := sanitizeClientLogValue(remoteAddr)

	c, err := s.chatRegistry().GetChat(chatIDStr)
	if err != nil {
		//nolint:gosec // Chat ID and remote address are sanitized before logging.
		log.Printf(
			"error: chat: could not get chat %s for %s: %v",
			chatIDForLog, remoteAddrForLog, err,
		)
		sendChatInitEvent(ws, message.EventConnInitNoSuchChat)
		return
	}
	if c == nil {
		//nolint:gosec // Chat ID and remote address are sanitized before logging.
		log.Printf("info: chat: chat %s does not exist for %s", chatIDForLog, remoteAddrForLog)
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

		//nolint:gosec // Chat ID is sanitized before logging.
		log.Printf("%s: chat: could not add new user to chat %s: %v", level, chatIDForLog, err)
		sendChatInitEvent(ws, eventID)
		return
	}

	userNameForLog := sanitizeClientLogValue(usr.Name)
	//nolint:gosec // User name, chat ID and remote address are sanitized before logging.
	log.Printf("info: chat: connected user [%d %s] to chat %s from %s, joins left after add: %d",
		usr.ID, userNameForLog, chatIDForLog, remoteAddrForLog, c.RestJoins())

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
