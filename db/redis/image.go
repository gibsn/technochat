package redis

import (
	"fmt"

	"technochat/entity"
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
