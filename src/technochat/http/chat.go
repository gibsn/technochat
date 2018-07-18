package http

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"net/http"
	"technochat/chat"

	"github.com/google/uuid"
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

	ch := chat.GetChat(chatIDStr)
	if ch == nil {
		log.Printf("info: chat: chat %s does not exist", chatIDStr)
		chat.SendEvent(ws, chat.EventConnInitNoSuchChat, nil)
		return
	}
	if ch.RestJoins() <= 0 {
		log.Printf("info: chat: maxUsers limit reached for chat %s", chatIDStr)
		chat.SendEvent(ws, chat.EventConnInitMaxUsrsReached, nil)
		return
	}

	usr := ch.AddUser(ws)
	usr.SendEvent(chat.EventConnInitOk, usr.Name)
	ch.SendServerNotify("user " + usr.Name + " joined")

	for {
		msg := chat.WSMessage{}
		if err := usr.WS.ReadJSON(&msg); err != nil {
			log.Printf("error: chat: could not read message from user [%d/%s]: %v", usr.ID, usr.Name, err)
			ch.DelUser(usr.ID)
			ch.SendServerNotify("user " + usr.Name + " has left")
			break
		}
		msg.Name = usr.Name
		//TODO: check types
		ch.SendAll(msg)
	}
}
