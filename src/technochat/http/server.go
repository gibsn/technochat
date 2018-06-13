package http

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"technochat/db"
)

const (
	gracefulTime = 5 * time.Second
)

type Server struct {
	addr string

	db     db.DB
	server *http.Server
}

type Response struct {
	Code int         `json:"code,omitempty"`
	Body interface{} `json:"body,omitempty"`
}

type TechnochatHandler func(*http.Request) (int, interface{}, error)

func NewServer(addr string, db db.DB) *Server {
	return &Server{
		addr:   addr,
		db:     db,
		server: &http.Server{Addr: addr, Handler: nil},
	}
}

func (s *Server) Init() {
	log.Println("http: initialising")

	// web view
	http.HandleFunc("/message/view", respondPage(s.messageView))

	// API
	http.HandleFunc("/api/v1/message/add", respondAPI(s.messageAdd))
	http.HandleFunc("/api/v1/message/view", respondAPI(s.messageView))

	log.Println("http: successfully initialised")
}

func (s *Server) Routine() {
	if err := s.server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalln("fatal: http:", err)
	}
}

func (s *Server) Shutdown() {
	log.Println("http: shutting down")

	ctx, _ := context.WithTimeout(context.Background(), gracefulTime)
	if err := s.server.Shutdown(ctx); err != nil {
		log.Println("error: http:", err)
	}
}

func getRealRemoteAddr(r *http.Request) string {
	if xRealIp := r.Header.Get("X-Real-Ip"); xRealIp != "" {
		return xRealIp
	} else {
		return r.RemoteAddr
	}
}

func respondAPI(h TechnochatHandler) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		remoteAddr := getRealRemoteAddr(r)

		var (
			resp Response
			err  error
		)

		w.Header().Add("Content-Type", "application/json")

		resp.Code, resp.Body, err = h(r)
		if err != nil {
			switch resp.Code {
			case http.StatusBadRequest:
				log.Printf("info: http: bad request from %s: %v\n", remoteAddr, err)
				resp.Body = err.Error()
			case http.StatusForbidden:
				log.Printf("info: http: forbidden for %s: %v\n", remoteAddr, err)
				resp.Body = err.Error()
			case http.StatusInternalServerError:
				log.Printf("error: http: internal server error for %s: %v\n", remoteAddr, err)
				resp.Body = http.StatusText(resp.Code)
			default:
				resp.Body = http.StatusText(resp.Code)
			}
		}

		respMarshalled, _ := json.Marshal(resp)
		w.Write(respMarshalled)
	}
}

func respondPage(h TechnochatHandler) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		remoteAddr := getRealRemoteAddr(r)
		code, body, err := h(r)

		switch code {
		case http.StatusOK:
			w.Write([]byte(body.(string)))
		case http.StatusBadRequest:
			log.Printf("info: http: bad request from %s: %v\n", remoteAddr, err)
			http.Error(w, err.Error(), code)
		case http.StatusForbidden:
			log.Printf("info: http: forbidden for %s: %v\n", remoteAddr, err)
			http.Error(w, err.Error(), code)
		case http.StatusInternalServerError:
			log.Printf("error: http: internal server error for %s: %v\n", remoteAddr, err)
			http.Error(w, http.StatusText(code), code)
		default:
			http.Error(w, http.StatusText(code), code)
		}
	}
}
