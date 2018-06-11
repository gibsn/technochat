package http

import (
	"log"
	"net/http"
)

type Server struct {
	addr string
}

func NewServer(addr string) *Server {
	return &Server{
		addr: addr,
	}
}

func (s *Server) Init() {
	log.Println("http: initialising")

	http.HandleFunc("/api/v1/message/add", s.messageAdd)

	http.HandleFunc("/", s.index)
	http.HandleFunc("/message/view", s.messageView)

	log.Println("http: successfully initialised")
}

func (s *Server) Routine() {
	log.Fatal(http.ListenAndServe(s.addr, nil))
}

func (s *Server) index(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/static/index.html", http.StatusMovedPermanently)
}
