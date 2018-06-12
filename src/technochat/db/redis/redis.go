package redis

import (
	"fmt"
	"log"

	"github.com/mediocregopher/radix.v2/pool"
)

const (
	poolSize = 10
)

type Redis struct {
	addr string

	pool *pool.Pool
}

func NewRedis(addr string) *Redis {
	return &Redis{
		addr: addr,
	}
}

func (r *Redis) Init() {
	log.Println("redis: initialising")

	p, err := pool.New("tcp", r.addr, poolSize)
	if err != nil {
		log.Fatalln("redis: could not create new connection pool:", err)
	}

	r.pool = p

	log.Println("redis: successfully initialised")
}

func (r *Redis) Shutdown() {
	log.Println("redis: shutting down")
}

func (r *Redis) AddMessage(messageID, message string) error {
	if err := r.pool.Cmd("HSET", "links", messageID, message).Err; err != nil {
		return fmt.Errorf("could not add message: %s", err)
	}

	return nil
}

func (r *Redis) GetMessage(messageID string) (string, error) {
	resp := r.pool.Cmd("HGET", "links", messageID)
	if resp.Err != nil {
		return "", fmt.Errorf("could not get message with ID %s: %s", messageID, resp.Err)
	}

	message, err := resp.Str()
	if err != nil {
		return "", fmt.Errorf("could not get message with ID %s: %s", messageID, err)
	}

	return message, nil
}

func (r *Redis) DeleteMessage(messageID string) error {
	if err := r.pool.Cmd("HDEL", "links", messageID).Err; err != nil {
		return fmt.Errorf("could not delete message with ID %s: %s", messageID, err)
	}

	return nil
}
