package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"technochat/db/redis"
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
	dbAddr := flag.String("d", "redis:6379", "addr:port of db")
	flag.Parse()

	db := redis.NewRedis(*dbAddr)
	httpServer := http.NewServer(*addr, db)

	log.Println("technochat: initialising")

	httpServer.Init()
	db.Init()

	log.Println("technochat: successfully initialised")
	log.Println("technochat: starting")

	go httpServer.Routine()

	wait()
	httpServer.Shutdown()
	db.Shutdown()

	log.Println("technochat: exited")
}
