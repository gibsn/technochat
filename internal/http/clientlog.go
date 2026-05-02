package http

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"unicode"
)

const (
	clientLogMaxBodyBytes = 4096
	clientLogMaxEventLen  = 80
	clientLogMaxValueLen  = 300
)

type ClientLogRequest struct {
	Event string                 `json:"event"`
	Data  map[string]interface{} `json:"data"`
}

func (s *Server) clientLog(r *http.Request) (int, interface{}, error) {
	if r.Method != http.MethodPost {
		return http.StatusBadRequest, nil, fmt.Errorf("POST required")
	}

	var req ClientLogRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, clientLogMaxBodyBytes)).Decode(&req); err != nil {
		return http.StatusBadRequest, nil, fmt.Errorf("could not decode client log: %w", err)
	}

	req.Event = strings.TrimSpace(req.Event)
	if req.Event == "" {
		return http.StatusBadRequest, nil, fmt.Errorf("empty event")
	}
	if len(req.Event) > clientLogMaxEventLen {
		return http.StatusBadRequest, nil, fmt.Errorf("event is too long")
	}
	if !isSafeClientLogEvent(req.Event) {
		return http.StatusBadRequest, nil, fmt.Errorf("invalid event")
	}

	//nolint:gosec // Client diagnostics are sanitized before logging.
	log.Printf(
		"info: client: event=%s from=%s ua=%q data=%s",
		req.Event,
		sanitizeClientLogValue(getRealRemoteAddr(r)),
		sanitizeClientLogValue(r.UserAgent()),
		formatClientLogData(req.Data),
	)

	return http.StatusOK, "ok", nil
}

func formatClientLogData(data map[string]interface{}) string {
	if len(data) == 0 {
		return "{}"
	}

	keys := make([]string, 0, len(data))
	for key := range data {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		value := sanitizeClientLogValue(fmt.Sprintf("%v", data[key]))
		if len(value) > clientLogMaxValueLen {
			value = value[:clientLogMaxValueLen] + "..."
		}
		parts = append(parts, fmt.Sprintf("%s=%q", sanitizeClientLogValue(key), value))
	}

	return "{" + strings.Join(parts, ", ") + "}"
}

func isSafeClientLogEvent(event string) bool {
	for _, r := range event {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			continue
		}

		return false
	}

	return true
}

func sanitizeClientLogValue(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}

		return r
	}, value)
}
