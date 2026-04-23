package redis

import (
	"fmt"

	"technochat/entity"

	"github.com/mediocregopher/radix.v2/redis"
)

func newImageKey(id string) string {
	return fmt.Sprintf("%s:%s", imageKeyPrefix, id)
}

func (r *Redis) AddImage(img entity.Image) error {
	key := newImageKey(img.ID)

	if err := r.pool.Cmd(
		"HMSET", key,
		imgBodyKey, img.Body,
		"EX", img.TTL,
	).Err; err != nil {
		return fmt.Errorf("could not add image: %w", err)
	}

	return nil
}

func newImageFromRedis(id string, redisResp map[string]string) (entity.Image, error) {
	img := entity.Image{
		ID: id,
	}

	img.Body = []byte(redisResp[imgBodyKey])

	return img, nil
}

func (r *Redis) GetImage(imageID string) (entity.Image, error) {
	key := newImageKey(imageID)

	resp := r.pool.Cmd("HGETALL", key)
	if err := resp.Err; err != nil {
		if err == redis.ErrRespNil {
			return entity.Image{}, entity.ErrNotFound
		}

		return entity.Image{}, fmt.Errorf(
			"could not get image with ID %s: %w", imageID, resp.Err,
		)
	}

	image, err := resp.Map()
	if err != nil {
		return entity.Image{}, fmt.Errorf(
			"could not get image with ID %s: %w", imageID, err,
		)
	}

	// redis may return empty response but no error
	if len(image) == 0 {
		return entity.Image{}, entity.ErrNotFound
	}

	return newImageFromRedis(imageID, image)
}

func (r *Redis) DeleteImage(imageID string) error {
	key := newImageKey(imageID)

	if err := r.pool.Cmd("DEL", key).Err; err != nil {
		if err == redis.ErrRespNil {
			return entity.ErrNotFound
		}

		return fmt.Errorf("could not delete image with ID %s: %w", imageID, err)
	}

	return nil
}
