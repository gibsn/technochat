//go:build integration_tests
// +build integration_tests

package http

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"technochat/entity"
)

var (
	imageViewAPI = testAPIAddr + imageViewPath

	dummyImageBytes = []byte{0x0, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7}
)

var (
	errNotFound = fmt.Errorf("not found")
)

func imageView(id string) (entity.Image, error) {
	client := http.Client{
		Timeout: 1000 * time.Millisecond,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	req := imageViewRequest{
		ID: id,
	}

	reqBody := &bytes.Buffer{}
	if err := json.NewEncoder(reqBody).Encode(req); err != nil {
		return entity.Image{}, fmt.Errorf("could not encode request: %w", err)
	}

	resp, err := client.Post(imageViewAPI, "application/json", reqBody)
	if err != nil {
		return entity.Image{}, fmt.Errorf("could not make a http request: %w", err)
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusNotFound {
			return entity.Image{}, errNotFound
		}

		body, _ := io.ReadAll(resp.Body)

		return entity.Image{}, fmt.Errorf("status is %d, body is '%s'", resp.StatusCode, body)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return entity.Image{}, fmt.Errorf("could not read body")
	}

	return entity.Image{
		ID:   id,
		Body: body,
	}, nil
}

func TestImageViewAfterAdd(t *testing.T) {
	id, err := addImage(dummyImageBytes)
	assert.Nil(t, err)

	t.Logf("successfully added an image, id is '%s'", id)

	image, err := imageView(id)
	assert.Nil(t, err)
	assert.Equal(t, image.Body, dummyImageBytes)

	t.Logf("images are equal")
}

func TestImageViewAfterView(t *testing.T) {
	id, err := addImage(dummyImageBytes)
	assert.Nil(t, err)

	t.Logf("successfully added an image, id is '%s'", id)

	image, err := imageView(id)
	assert.Nil(t, err)
	assert.Equal(t, image.Body, dummyImageBytes)

	t.Logf("images are equal")

	image, err = imageView(id)
	assert.ErrorIs(t, err, errNotFound)
}
