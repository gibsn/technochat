package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"technochat/http"
)

func wait() {
	signals := []os.Signal{syscall.SIGINT, syscall.SIGTERM}
	ch := make(chan os.Signal, len(signals))
	signal.Notify(ch, signals...)

	select {
	case s := <-ch:
		log.Println("technochat: got signal", s)

	}
}

func main() {
	addr := flag.String("l", ":8080", "addr:port to listen on")
	flag.Parse()

	httpServer := http.NewServer(*addr)

	log.Println("technochat: initialising")

	httpServer.Init()

	log.Println("technochat: successfully initialised")
	log.Println("technochat: starting")

	go httpServer.Routine()

	wait()
	httpServer.Shutdown()

	log.Println("technochat: exited")
}
