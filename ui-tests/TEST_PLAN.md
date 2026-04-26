# UI test plan

## What is covered now

- UI unit tests (`make ui-unit-tests`):
  - chat unread title behavior with a mocked WebSocket;
  - message form textarea counter and client-side length limit;
  - message form rendering, encrypted link assembly, and copy button behavior with a mocked API response;
  - message add page renders API validation errors without clearing the original text.
- UI end-to-end tests (`make ui-e2e-tests`):
  - create a one-time encrypted message through the browser;
  - create a reply from `messageview.html` and verify the generated reply can be opened;
  - open the generated link, decrypt the message in the browser, and verify the second open returns `not found`;
  - create a temporary chat through the browser and verify two participants exchange a message over WebSocket;
  - verify the chat join limit rejects a participant beyond the configured maximum.
- API and storage behavior:
  - Go tests cover message/image/chat request validation and Redis-backed flows.

## Test cases still worth adding

- UI unit level:
  - chat init form sends the selected `max_users`, renders the join link, and handles API errors;
- UI end-to-end level:
  - mobile viewport smoke checks for message add, message view, chat init, and join chat.
- API/integration level:
  - Redis TTL expiration for messages, images, and chats;
  - Nginx route smoke checks for static assets and API proxy paths.
