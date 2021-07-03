package http

import (
	"fmt"
	"net/http"
	"strconv"
	"unicode/utf8"

	"technochat/db"
)

const (
	maxTextLength = 1024
	maxTTL        = 60 * 60 * 24 * 7 * 1 // 1 week
)

type MessageAddRequest struct {
	method string

	text string
	ttl  int
}

type MessageAddResponse struct {
	Link string `json:"link"`
}

func NewMessageAddRequest(r *http.Request) (*MessageAddRequest, error) {
	req := &MessageAddRequest{}

	var (
		i   int
		err error
	)

	if err = r.ParseMultipartForm(0); err != nil {
		return nil, err
	}

	req.method = r.Method
	req.text = r.PostFormValue("text")

	if i, err = strconv.Atoi(r.PostFormValue("ttl")); err != nil {
		return nil, fmt.Errorf("could not get ttl: %s", err)
	}

	req.ttl = i

	return req, nil
}

func (req *MessageAddRequest) Validate() error {
	if req.method != "POST" {
		return fmt.Errorf("POST required")
	}

	if len(req.text) == 0 {
		return fmt.Errorf("empty text")
	}
	if !utf8.ValidString(req.text) {
		return fmt.Errorf("text must be a valid UTF8 string")
	}
	if utf8.RuneCountInString(req.text) > maxTextLength {
		return fmt.Errorf("maximum text length of %d is allowed", maxTextLength)
	}

	if req.ttl < 0 {
		return fmt.Errorf("invalid TTL")
	}

	if req.ttl > maxTTL {
		return fmt.Errorf("maximum TTL of %d is allowed", maxTTL)
	}

	return nil
}

func (s *Server) messageAdd(r *http.Request) (int, interface{}, error) {
	req, err := NewMessageAddRequest(r)
	if err != nil {
		return http.StatusBadRequest, nil, err
	}

	if err = req.Validate(); err != nil {
		return http.StatusBadRequest, nil, err
	}

	messageID, err := db.NewMessageID()
	if err != nil {
		return http.StatusInternalServerError, nil, err
	}

	if err := s.db.AddMessage(messageID, req.text, req.ttl); err != nil {
		return http.StatusInternalServerError, nil, err
	}

	resp := &MessageAddResponse{
		Link: fmt.Sprintf("https://%s/html/messageview.html?id=%s", r.Host, messageID),
	}

	return http.StatusOK, resp, nil
}
