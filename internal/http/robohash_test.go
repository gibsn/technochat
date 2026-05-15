package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRoboHashReturnsVendoredSVG(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/robohash/alice.svg?size=50x50", nil)
	rec := httptest.NewRecorder()

	var srv Server
	srv.roboHash(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, rec.Code, rec.Body.String())
	}
	if contentType := rec.Header().Get("Content-Type"); contentType != "image/svg+xml; charset=utf-8" {
		t.Fatalf("expected svg content type, got %q", contentType)
	}

	body := rec.Body.String()
	if !strings.Contains(body, `width="50" height="50"`) {
		t.Fatalf("expected requested size in svg: %s", body)
	}
	if !strings.Contains(body, "data:image/png;base64,") {
		t.Fatalf("expected vendored png layers embedded in svg")
	}
	if strings.Contains(body, "robohash.org") {
		t.Fatalf("did not expect external robohash URL in svg")
	}
}
