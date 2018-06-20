package http

import (
	"fmt"
	"net/http"

	"technochat/db"
)

type MessageViewRequest struct {
	method string

	id string
}

type MessageViewResponse struct {
	Text string `json:"text"`
}

func NewMessageViewRequest(r *http.Request) (*MessageViewRequest, error) {
	req := &MessageViewRequest{}

	req.method = r.Method
	req.id = r.URL.Query().Get("id")

	return req, nil
}

func (req *MessageViewRequest) Validate() error {
	if req.method != "GET" {
		return fmt.Errorf("GET required")
	}

	if len(req.id) == 0 {
		return fmt.Errorf("empty id")
	}

	return nil
}

func (s *Server) messageView(r *http.Request) (int, interface{}, error) {
	req, err := NewMessageViewRequest(r)
	if err != nil {
		return http.StatusBadRequest, nil, err
	}

	if err := req.Validate(); err != nil {
		return http.StatusBadRequest, nil, err
	}

	if isMessengerResolver(r) {
		return http.StatusForbidden, nil, fmt.Errorf("forbidden")
	}

	message, err := s.db.GetMessage(req.id)
	if err != nil {
		if err != db.ErrNotFound {
			return http.StatusNotFound, nil, err
		}

		return http.StatusInternalServerError, nil, err
	}

	if err := s.db.DeleteMessage(req.id); err != nil {
		if err != db.ErrNotFound {
			return http.StatusNotFound, nil, err
		}

		return http.StatusInternalServerError, nil, err
	}

	resp := &MessageViewResponse{
		Text: message,
	}

	return http.StatusOK, resp, nil
}
