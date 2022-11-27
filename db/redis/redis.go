package redis

import (
	"fmt"
	"log"

	"github.com/mediocregopher/radix.v2/pool"
	"github.com/mediocregopher/radix.v2/redis"

	"technochat/db"
	"technochat/entity"
)

const (
	poolSize = 10
)

const (
	msgKeyPrefix = "msg"

	msgTextKey   = "text"
	msgImagesKey = "imgs"
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

func (r *Redis) AddMessage(message entity.Message) error {
	key := "links:" + message.ID

	if err := r.pool.Cmd(
		"HMSET", key,
		msgTextKey, message.Text,
		msgImagesKey, message.Images.Encode(),
		"EX", message.TTL,
	).Err; err != nil {
		return fmt.Errorf("could not add message: %w", err)
	}

	return nil
}

func newMessageFromRedis(id string, redisResp map[string]string) (entity.Message, error) {
	msg := entity.Message{
		ID: id,
	}

	msg.Text = redisResp[msgTextKey]
	msg.Images.Decode(redisResp[msgImagesKey])

	if len(msg.Text) == 0 {
		return entity.Message{}, fmt.Errorf("invalid message: text is missing")
	}

	return msg, nil
}

func (r *Redis) GetMessage(messageID string) (entity.Message, error) {
	key := "links:" + messageID

	resp := r.pool.Cmd("HGETALL", key)
	if err := resp.Err; err != nil {
		if err == redis.ErrRespNil {
			return entity.Message{}, db.ErrNotFound
		}

		return entity.Message{}, fmt.Errorf(
			"could not get message with ID %s: %w", messageID, resp.Err,
		)
	}

	message, err := resp.Map()
	if err != nil {
		return entity.Message{}, fmt.Errorf(
			"could not get message with ID %s: %w", messageID, err,
		)
	}

	return newMessageFromRedis(messageID, message)
}

func (r *Redis) DeleteMessage(messageID string) error {
	key := "links:" + messageID

	if err := r.pool.Cmd("DEL", key).Err; err != nil {
		if err == redis.ErrRespNil {
			return db.ErrNotFound
		}

		return fmt.Errorf("could not delete message with ID %s: %w", messageID, err)
	}

	return nil
}
