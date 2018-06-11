package main

import (
	"flag"
	"log"
	"time"

	"technochat/http"
)

type Technochat struct {
	httpServer *http.Server
}

func NewTechnochat(addr string) *Technochat {
	return &Technochat{
		httpServer: http.NewServer(addr),
	}
}

func (t *Technochat) Init() {
	log.Println("technochat: initialising")

	t.httpServer.Init()

	log.Println("technochat: successfully initialised")
}

func (t *Technochat) Routine() {
	go t.httpServer.Routine()

	for {
		time.Sleep(1 * time.Minute)
	}
}

func main() {
	addr := flag.String("l", ":8080", "addr:port to listen on")
	flag.Parse()

	technochat := NewTechnochat(*addr)
	technochat.Init()
	technochat.Routine()
}
