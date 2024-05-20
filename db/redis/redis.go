package redis

import (
	"log"

	"github.com/mediocregopher/radix.v2/pool"
)

const (
	poolSize = 10
)

const (
	msgKeyPrefix   = "msg"
	imageKeyPrefix = "img"

	msgTextKey   = "text"
	msgImagesKey = "imgs"

	imgBodyKey = "body"
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
