package http

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"technochat/entity"
)

type imageViewRequest struct {
	method string `json:"-"`

	ID string `json:"id"`
}

func newImageViewRequest(r *http.Request) (*imageViewRequest, error) {
	req := &imageViewRequest{
		method: r.Method,
	}

	if err := json.NewDecoder(r.Body).Decode(req); err != nil {
		return nil, fmt.Errorf("could not unmarshal request: %w", err)
	}

	return req, nil
}

func (req *imageViewRequest) validate() error {
	if req.method != http.MethodPost {
		return fmt.Errorf("POST required")
	}

	if len(req.ID) == 0 {
		return fmt.Errorf("empty id")
	}

	return nil
}

func (s *Server) imageView(r *http.Request) (int, []byte, error) {
	req, err := newImageViewRequest(r)
	if err != nil {
		return http.StatusBadRequest, nil, err
	}

	if err = req.validate(); err != nil {
		return http.StatusBadRequest, nil, err
	}

	image, err := s.db.GetImage(req.ID)
	if err != nil {
		if err == entity.ErrNotFound {
			return http.StatusNotFound, nil, err
		}

		return http.StatusInternalServerError, nil, fmt.Errorf("could not fetch image: %w", err)
	}

	if err := s.db.DeleteImage(req.ID); err != nil {
		if err == entity.ErrNotFound {
			return http.StatusNotFound, nil, err
		}

		return http.StatusInternalServerError, nil, fmt.Errorf("could not delete image: %w", err)
	}

	log.Printf("info: deleted image '%s' of size '%d'", req.ID, len(image.Body))

	return http.StatusOK, image.Body, nil
}
