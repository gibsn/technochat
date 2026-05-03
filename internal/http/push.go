package http

import "net/http"

type PushVAPIDPublicKeyResponse struct {
	PublicKey string `json:"public_key"`
	Enabled   bool   `json:"enabled"`
}

func (s *Server) pushVAPIDPublicKey(_ *http.Request) (int, interface{}, error) {
	return http.StatusOK, PushVAPIDPublicKeyResponse{
		PublicKey: s.pushPublicKey,
		Enabled:   s.pushPublicKey != "",
	}, nil
}
