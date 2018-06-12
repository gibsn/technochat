package http

import (
	"fmt"
	"net/http"
)

type MessageViewRequest struct {
	method string

	id string
}

type MessageViewResponse struct {
	Text string `"json:text"`
}

func NewMessageViewRequest(r *http.Request) (*MessageViewRequest, error) {
	req := &MessageViewRequest{}

	if err := r.ParseForm(); err != nil {
		return nil, err
	}

	req.method = r.Method
	req.id = r.PostFormValue("id")

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

// TODO
func (s *Server) messageView(r *http.Request) (int, interface{}, error) {
	req, err := NewMessageViewRequest(r)
	if err != nil {
		return http.StatusBadRequest, nil, err
	}

	if err := req.Validate(); err != nil {
		return http.StatusBadRequest, nil, err
	}

	return http.StatusNotImplemented, nil, err
}
