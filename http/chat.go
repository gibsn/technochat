package http

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"net/http"

	"github.com/google/uuid"

	"technochat/chat"
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

	if err := r.ParseForm(); err != nil {
		log.Printf("error: chat: could not parse form: %v", err)
		return
	}
	chatIDStr := r.FormValue("id")

	c := chat.GetChat(chatIDStr)
	if c == nil {
		log.Printf("info: chat: chat %s does not exist", chatIDStr)
		return
	}
	if c.RestJoins() <= 0 {
		log.Printf("info: chat: maxUsers limit reached for chat %s", chatIDStr)
		return
	}

	usr := c.AddUser(ws)
	usr.Routine()

	c.DelUser(usr.ID)
}
