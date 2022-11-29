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
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

var (
	messageAddAPI = testAPIAddr + messageAddPath

	dummyText = "this a test text"
	dummyImgs = "6a938b32-e701-4807-b099-ddfbd19ecd22,46f46909-4871-4a98-b3a7-be605032efe5"
	dummyTTL  = 86400
)

func addMessage(text string) (string, error) {
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
	if err := w.WriteField(TextPartName, text); err != nil {
		return "", fmt.Errorf("could not write text: %w", err)
	}
	if err := w.WriteField(ImgsPartName, dummyImgs); err != nil {
		return "", fmt.Errorf("could not write imgs: %w", err)
	}

	if err := w.Close(); err != nil {
		return "", fmt.Errorf("could not close writer: %w", err)
	}

	// t.Logf(body.String())

	resp, err := client.Post(messageAddAPI, w.FormDataContentType(), body)
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
	id := specificBody["link"].(string)

	return id, nil
}

func TestAddMessage(t *testing.T) {
	link, err := addMessage(dummyText)
	assert.Nil(t, err)

	id := strings.Split(link, "?id=")[1]

	t.Logf("successfully added a message, id is '%s'", id)
}
