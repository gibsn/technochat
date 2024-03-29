package main

import (
	"flag"
	"log"
	"math/rand"
	"os"
	"os/signal"
	"syscall"
	"time"

	"technochat/db/redis"
	"technochat/http"
)

func wait() {
	signals := []os.Signal{syscall.SIGINT, syscall.SIGTERM}
	ch := make(chan os.Signal, len(signals))
	signal.Notify(ch, signals...)

	s := <-ch

	log.Println("info: got signal", s)
}

func main() {
	rand.Seed(time.Now().UTC().UnixNano())

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
