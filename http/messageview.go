package http

import (
	"fmt"
	"html"
	"log"
	"net/http"
	"technochat/entity"
)

type messageViewRequest struct {
	method string

	id string
}

type MessageViewResponse struct {
	Text   string   `json:"text"`
	Images []string `json:"imgs,omitempty"`
}

func newMessageViewRequest(r *http.Request) *messageViewRequest {
	req := &messageViewRequest{}

	req.method = r.Method
	req.id = r.URL.Query().Get("id")

	return req
}

func (req *messageViewRequest) Validate() error {
	// TODO should be POST
	if req.method != "GET" {
		return fmt.Errorf("GET required")
	}

	if len(req.id) == 0 {
		return fmt.Errorf("empty id")
	}

	return nil
}

func (s *Server) messageView(r *http.Request) (int, interface{}, error) {
	req := newMessageViewRequest(r)

	if err := req.Validate(); err != nil {
		return http.StatusBadRequest, nil, err
	}

	message, err := s.db.GetMessage(req.id)
	if err != nil {
		if err == entity.ErrNotFound {
			return http.StatusNotFound, nil, err
		}

		return http.StatusInternalServerError, nil, fmt.Errorf("could not fetch message: %w", err)
	}

	if err := s.db.DeleteMessage(req.id); err != nil {
		if err == entity.ErrNotFound {
			return http.StatusNotFound, nil, err
		}

		return http.StatusInternalServerError, nil, fmt.Errorf("could not delete message: %w", err)
	}

	log.Printf("info: deleted message of size '%d' with id '%s'", len(message.Text), req.id)

	resp := &MessageViewResponse{
		Text:   html.EscapeString(message.Text),
		Images: message.Images,
	}

	return http.StatusOK, resp, nil
}
