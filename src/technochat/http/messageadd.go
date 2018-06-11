package http

import (
	"net/http"
)

func (s *Server) messageAdd(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "not implemented", http.StatusNotImplemented)
}
