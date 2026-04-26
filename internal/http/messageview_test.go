//go:build integration_tests
// +build integration_tests

package http

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"testing"

	"technochat/pkg/entity"

	"github.com/stretchr/testify/assert"
)

func messageView(id string) (entity.Message, error) {
	client := http.Client{
		Timeout: testRequestTimeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	url := url.URL{
		Scheme: "https",
		Host:   "127.0.0.1",
		Path:   messageViewPath,
	}

	query := url.Query()
	query.Add("id", id)

	url.RawQuery = query.Encode()

	httpReq, err := http.NewRequest(http.MethodGet, url.String(), nil)
	if err != nil {
		return entity.Message{}, fmt.Errorf("could not make a request: %w", err)
	}

	httpReq.Header.Add("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		return entity.Message{}, fmt.Errorf("could not make a http request: %w", err)
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)

		return entity.Message{}, fmt.Errorf("status is %d, body is '%s'", resp.StatusCode, body)
	}

	viewResp := &Response{}
	if err := json.NewDecoder(resp.Body).Decode(viewResp); err != nil {
		return entity.Message{}, fmt.Errorf("could not unmarshal response: %w", err)
	}

	if viewResp.Code != http.StatusOK {
		if viewResp.Code == http.StatusNotFound {
			return entity.Message{}, errNotFound
		}

		return entity.Message{}, fmt.Errorf(
			"json status is %d, json body is '%s'", viewResp.Code, viewResp.Body,
		)
	}

	specificBody := viewResp.Body.(map[string]interface{})

	msg := entity.Message{
		ID:   id,
		Text: specificBody["text"].(string),
	}

	for _, v := range specificBody["imgs"].([]interface{}) {
		msg.Images = append(msg.Images, v.(string))
	}

	return msg, nil
}

func TestMessageViewAfterAdd(t *testing.T) {
	link, err := addMessage(dummyText)
	if !assert.NoError(t, err) {
		return
	}

	id, err := messageIDFromLink(link)
	if !assert.NoError(t, err) {
		return
	}

	t.Logf("successfully added a message, id is '%s'", id)

	msg, err := messageView(id)
	if !assert.NoError(t, err) {
		return
	}
	assert.Equal(t, msg.Text, dummyText)
	assert.Equal(t, msg.Images.Encode(), dummyImgs)

	t.Logf("message are equal")
}

func TestMessageViewAfterView(t *testing.T) {
	link, err := addMessage(dummyText)
	if !assert.NoError(t, err) {
		return
	}

	id, err := messageIDFromLink(link)
	if !assert.NoError(t, err) {
		return
	}

	t.Logf("successfully added a message, id is '%s'", id)

	msg, err := messageView(id)
	if !assert.NoError(t, err) {
		return
	}
	assert.Equal(t, msg.Text, dummyText)
	assert.Equal(t, msg.Images.Encode(), dummyImgs)

	t.Logf("message are equal")

	_, err = messageView(id)
	assert.ErrorIs(t, err, errNotFound)
}
