package http

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"net/http"

	"github.com/google/uuid"

	"technochat/internal/chat"
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
	})

	chat.AddChat(newChat)
	log.Printf("info: chat: started a new chat %s for %d people", newChat.ID, newChat.RestJoins())

	resp := ChatInitResponse{
		ID: newChat.ID,
	}

	go chat.HandleChat(newChat)

	return http.StatusOK, resp, nil
}

func (s *Server) chatConnect(w http.ResponseWriter, r *http.Request) {
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
		return
	}
	if c.RestJoins() <= 0 {
		log.Printf("info: chat: maxUsers limit reached for chat %s from %s", chatIDStr, remoteAddr)
		return
	}

	log.Printf("info: chat: incoming connect for chat %s from %s, joins left before add: %d",
		chatIDStr, remoteAddr, c.RestJoins())

	usr, err := c.AddUser(ws)
	if err != nil {
		level := "error"

		if err == chat.ErrInvitationQuotaExceeded {
			level = "warning"
		}

		log.Printf("%s: chat: could not add new user to chat %s: %v", level, chatIDStr, err)
		return
	}

	log.Printf("info: chat: connected user [%d %s] to chat %s from %s, joins left after add: %d",
		usr.ID, usr.Name, chatIDStr, remoteAddr, c.RestJoins())

	usr.Routine()

	c.DelUser(usr.ID)
}
