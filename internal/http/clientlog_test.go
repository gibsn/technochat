package http

import (
	"net/http"
	"strings"
	"testing"
)

func TestClientLogAcceptsDiagnosticEvent(t *testing.T) {
	s := &Server{}
	req, err := http.NewRequest(
		http.MethodPost,
		"/api/v1/client/log",
		strings.NewReader(`{"event":"chat_join_params_missing","data":{"has_id":true,"has_key":false}}`),
	)
	if err != nil {
		t.Fatal(err)
	}

	code, body, err := s.clientLog(req)
	if err != nil {
		t.Fatalf("clientLog returned error: %v", err)
	}
	if code != http.StatusOK {
		t.Fatalf("unexpected code: got %d, want %d", code, http.StatusOK)
	}
	if body != "ok" {
		t.Fatalf("unexpected body: got %v, want ok", body)
	}
}

func TestClientLogRejectsInvalidRequest(t *testing.T) {
	s := &Server{}
	req, err := http.NewRequest(http.MethodGet, "/api/v1/client/log", nil)
	if err != nil {
		t.Fatal(err)
	}

	code, _, err := s.clientLog(req)
	if err == nil {
		t.Fatal("clientLog returned nil error")
	}
	if code != http.StatusBadRequest {
		t.Fatalf("unexpected code: got %d, want %d", code, http.StatusBadRequest)
	}
}
