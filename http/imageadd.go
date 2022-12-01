package http

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"technochat/entity"
)

const (
	ImagePartName = "image"
	TTLPartName   = "ttl"
)

const (
	imageMaxSize = 5 * 1024 * 1024 // 5MB
)

type imageAddRequest struct {
	method string

	image []byte
	ttl   int
}

type imageAddResponse struct {
	ID string `json:"id"`
}

func newImageAddRequest(r *http.Request) (*imageAddRequest, error) {
	req := &imageAddRequest{}

	var (
		i   int
		err error
	)

	if err = r.ParseMultipartForm(imageMaxSize); err != nil {
		return nil, err
	}

	req.method = r.Method

	imageBody, _, err := r.FormFile(ImagePartName)
	if err != nil {
		return nil, fmt.Errorf("could not get image: %w", err)
	}

	imageBodyBytes, err := io.ReadAll(imageBody)
	if err != nil {
		return nil, fmt.Errorf("could not read image from request: %w", err)
	}

	req.image = imageBodyBytes

	if i, err = strconv.Atoi(r.FormValue(TTLPartName)); err != nil {
		return nil, fmt.Errorf("could not get ttl: %s", err)
	}

	req.ttl = i

	return req, nil
}

func (req *imageAddRequest) validate() error {
	if req.ttl < 0 {
		return fmt.Errorf("invalid TTL")
	}
	if req.ttl > maxTTL {
		return fmt.Errorf("maximum TTL of %d is allowed", maxTTL)
	}

	return nil
}

func (s *Server) imageAdd(r *http.Request) (int, interface{}, error) {
	req, err := newImageAddRequest(r)
	if err != nil {
		return http.StatusBadRequest, nil, err
	}

	if err = req.validate(); err != nil {
		return http.StatusBadRequest, nil, err
	}

	imageID, err := entity.NewImageID()
	if err != nil {
		return http.StatusInternalServerError, nil, err
	}

	if err := s.db.AddImage(entity.Image{
		ID:   imageID,
		Body: req.image,
		TTL:  req.ttl,
	}); err != nil {
		return http.StatusInternalServerError, nil, err
	}

	log.Printf("info: saved image of size '%d' with id '%s'", len(req.image), imageID)

	resp := imageAddResponse{
		ID: imageID,
	}

	return http.StatusOK, resp, nil
}
