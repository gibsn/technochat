//go:build integration_tests
// +build integration_tests

package http

import (
	"os"
	"strings"
)

func testAPIBaseURL() string {
	baseURL := os.Getenv("TECHNOCHAT_TEST_API_URL")
	if baseURL == "" {
		baseURL = "https://127.0.0.1"
	}

	return strings.TrimRight(baseURL, "/")
}
