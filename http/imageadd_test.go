//go:build integration_tests
// +build integration_tests

package http

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

const (
	testAPIAddr = "https://127.0.0.1"
)

var (
	imageAddAPI = testAPIAddr + imageAddPath
)

func addImage(img []byte) (string, error) {
	client := http.Client{
		Timeout: 1000 * time.Millisecond,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)

	if err := w.WriteField(TTLPartName, strconv.Itoa(dummyTTL)); err != nil {
		return "", fmt.Errorf("could not write ttl: %w", err)
	}
	imgWriter, err := w.CreateFormFile(ImagePartName, "some_image")
	if err != nil {
		return "", fmt.Errorf("could not write image: %w", err)
	}
	if _, err := imgWriter.Write(dummyImageBytes); err != nil {
		return "", fmt.Errorf("could not write image: %w", err)
	}

	if err := w.Close(); err != nil {
		return "", fmt.Errorf("could not close writer: %w", err)
	}

	// t.Logf(body.String())

	resp, err := client.Post(imageAddAPI, w.FormDataContentType(), body)
	if err != nil {
		return "", fmt.Errorf("could not make a http request: %w", err)
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("status is %d, body is '%s'", resp.StatusCode, body)
	}

	addResp := &Response{}
	if err := json.NewDecoder(resp.Body).Decode(addResp); err != nil {
		return "", fmt.Errorf("could not unmarshal response: %w", err)
	}

	if addResp.Code != http.StatusOK {
		return "", fmt.Errorf("json status is %d, json body is '%s'", addResp.Code, addResp.Body)
	}

	specificBody := addResp.Body.(map[string]interface{})
	id := specificBody["id"].(string)

	return id, nil
}

func TestAddImage(t *testing.T) {
	id, err := addImage(dummyImageBytes)
	assert.Nil(t, err)

	t.Logf("successfully added an image, id is '%s'", id)
}
