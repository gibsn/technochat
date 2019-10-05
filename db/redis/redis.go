package redis

import (
	"fmt"
	"log"

	"github.com/mediocregopher/radix.v2/pool"
	"github.com/mediocregopher/radix.v2/redis"

	"technochat/db"
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

func (r *Redis) AddMessage(messageID, message string, ttl int) error {
	key := "links:" + messageID

	if err := r.pool.Cmd("SET", key, message, "EX", ttl).Err; err != nil {
		return fmt.Errorf("could not add message: %s", err)
	}

	return nil
}

func (r *Redis) GetMessage(messageID string) (string, error) {
	key := "links:" + messageID

	resp := r.pool.Cmd("GET", key)
	if err := resp.Err; err != nil {
		if err == redis.ErrRespNil {
			return "", db.ErrNotFound
		}

		return "", fmt.Errorf("could not get message with ID %s: %s", messageID, resp.Err)
	}

	message, err := resp.Str()
	if err != nil {
		return "", fmt.Errorf("could not get message with ID %s: %s", messageID, err)
	}

	return message, nil
}

func (r *Redis) DeleteMessage(messageID string) error {
	key := "links:" + messageID

	if err := r.pool.Cmd("DEL", key).Err; err != nil {
		if err == redis.ErrRespNil {
			return db.ErrNotFound
		}

		return fmt.Errorf("could not delete message with ID %s: %s", messageID, err)
	}

	return nil
}
