package chat

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestHandlePushResponseIncludesProviderErrorBody(t *testing.T) {
	err := handlePushResponse(&http.Response{
		StatusCode: http.StatusBadRequest,
		Status:     "400 Bad Request",
		Body:       io.NopCloser(strings.NewReader(`{"error":"invalid vapid token"}`)),
	})

	if err == nil {
		t.Fatal("expected push provider error")
	}
	if !strings.Contains(err.Error(), "push provider returned 400 Bad Request") {
		t.Fatalf("expected status in error, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), `{\"error\":\"invalid vapid token\"}`) {
		t.Fatalf("expected escaped provider body in error, got %q", err.Error())
	}
}

func TestHandlePushResponseLimitsProviderErrorBody(t *testing.T) {
	err := handlePushResponse(&http.Response{
		StatusCode: http.StatusBadRequest,
		Status:     "400 Bad Request",
		Body: io.NopCloser(strings.NewReader(
			strings.Repeat("a", pushProviderErrorBodyLimit+1),
		)),
	})

	if err == nil {
		t.Fatal("expected push provider error")
	}
	if !strings.Contains(err.Error(), "(truncated)") {
		t.Fatalf("expected truncated marker in error, got %q", err.Error())
	}
	if strings.Contains(err.Error(), strings.Repeat("a", pushProviderErrorBodyLimit+1)) {
		t.Fatalf("expected provider body to be limited, got %q", err.Error())
	}
}

func TestHandlePushResponseKeepsGoneSubscriptionSentinel(t *testing.T) {
	err := handlePushResponse(&http.Response{
		StatusCode: http.StatusGone,
		Status:     "410 Gone",
		Body:       io.NopCloser(strings.NewReader("expired")),
	})

	if !errors.Is(err, ErrPushSubscriptionGone) {
		t.Fatalf("expected ErrPushSubscriptionGone, got %v", err)
	}
}
