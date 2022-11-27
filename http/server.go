package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"technochat/db"
)

const (
	gracefulTime = 5 * time.Second
)

var (
	messengerResolverUAs = [...]string{
		"LPX", // ICQ
		"Mozilla/5.0 (compatible; vkShare; +http://vk.com/dev/Share)", // VK
		"TelegramBot (like TwitterBot)",                               // telegram
	}
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

	// API
	http.HandleFunc("/api/v1/message/add", respondAPI(s.messageAdd))
	http.HandleFunc("/api/v1/message/view", respondAPI(s.messageView))
	http.HandleFunc("/api/v1/image/add", respondAPI(s.imageAdd))
	http.HandleFunc("/api/v1/chat/init", respondAPI(s.chatInit))
	http.HandleFunc("/api/v1/chat/connect", s.chatConnect)

	log.Println("http: successfully initialised")
}

func (s *Server) Routine() {
	if err := s.server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalln("fatal: http:", err)
	}
}

func (s *Server) Shutdown() {
	log.Println("http: shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), gracefulTime)
	defer cancel()

	if err := s.server.Shutdown(ctx); err != nil {
		log.Println("error: http:", err)
	}
}

func getRealRemoteAddr(r *http.Request) string {
	if xRealIP := r.Header.Get("X-Real-Ip"); xRealIP != "" {
		return xRealIP
	}

	return r.RemoteAddr
}

//nolint: deadcode, unused
func isMessengerResolver(r *http.Request) bool {
	for _, ua := range messengerResolverUAs {
		if ua == r.UserAgent() {
			return true
		}
	}

	return false
}

func respondAPI(h TechnochatHandler) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		remoteAddr := getRealRemoteAddr(r)

		var (
			resp Response
			err  error
		)

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

		respMarshalled, err := json.Marshal(resp)
		if err != nil {
			log.Printf("error: http: could not marshal response for %s: %v", remoteAddr, err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.Header().Add("Content-Type", "application/json")

		if _, err := w.Write(respMarshalled); err != nil {
			log.Printf("error: http: could not send response for %s: %v", remoteAddr, err)
		}
	}
}

//nolint: deadcode, unused
func respondPage(h TechnochatHandler) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		remoteAddr := getRealRemoteAddr(r)
		code, body, err := h(r)

		switch code {
		case http.StatusOK:
			if _, err = w.Write([]byte(fmt.Sprintf("%v", body))); err != nil {
				log.Printf("error: http: could not send response for %s: %v", remoteAddr, err)
				return
			}
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
