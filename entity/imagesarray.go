package entity

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
)

type ImagesArray []string

func (arr ImagesArray) Encode() string {
	return strings.Join(arr, ",")
}

func (arr *ImagesArray) Decode(s string) []string {
	if len(s) == 0 {
		return nil
	}

	*arr = strings.Split(s, ",")
	return *arr
}

func (arr ImagesArray) Validate() error {
	for _, imgID := range arr {
		if _, err := uuid.Parse(imgID); err != nil {
			return fmt.Errorf("invalid image id '%s': %w", imgID, err)
		}
	}

	return nil
}
