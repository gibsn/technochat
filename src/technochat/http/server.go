package http

import (
	"encoding/json"
	"log"
	"net/http"
)

type Server struct {
	addr string
}

type Response struct {
	Code  int         `json:code,omitempty`
	Error string      `json:error,omitempty`
	Body  interface{} `json:body,omitempty`
}

type TechnochatHandler func(*http.Request) (int, interface{}, error)

func NewServer(addr string) *Server {
	return &Server{
		addr: addr,
	}
}

func (s *Server) Init() {
	log.Println("http: initialising")

	http.HandleFunc("/", s.index)

	http.HandleFunc("/api/v1/message/add", respond(s.messageAdd))
	http.HandleFunc("/api/v1/message/view", respond(s.messageView))

	log.Println("http: successfully initialised")
}

func (s *Server) Routine() {
	log.Fatal(http.ListenAndServe(s.addr, nil))
}

func (s *Server) index(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/static/index.html", http.StatusMovedPermanently)
}

func getRealRemoteAddr(r *http.Request) string {
	if xRealIp := r.Header.Get("X-Real-Ip"); xRealIp != "" {
		return xRealIp
	} else {
		return r.RemoteAddr
	}
}

func respond(h TechnochatHandler) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		api := r.URL.EscapedPath()
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
				log.Printf("%s: bad request from %s: %v\n", api, remoteAddr, err)
				resp.Body = err.Error()
			case http.StatusForbidden:
				log.Printf("%s: forbidden for %s: %v\n", api, remoteAddr, err)
				resp.Body = err.Error()
			case http.StatusInternalServerError:
				log.Printf("%s: internal server error for %s: %v\n", api, remoteAddr, err)
				resp.Body = http.StatusText(resp.Code)
			default:
				resp.Body = http.StatusText(resp.Code)
			}
		}

		respMarshalled, _ := json.Marshal(resp)
		w.Write(respMarshalled)
	}
}
