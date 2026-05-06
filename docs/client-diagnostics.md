# Client Diagnostics

Client diagnostics are sent from the browser to `/api/v1/client/log`.
Each event is emitted by `reportChatDiagnostic` in `static/js/chat/chat.js`.

When adding, renaming, or removing client diagnostic events, update this file in
the same change.

## Common Fields

Most events include these fields automatically:

- `event` - event name.
- `data` - event-specific payload plus the common context below.
- `data.client_ts` - client timestamp in ISO 8601 format.
- `data.page_id` - random page instance id.
- `data.seq` - per-page diagnostic sequence number.
- `data.path` - current `window.location.pathname`.
- `data.search` - current `window.location.search`.
- `data.hash_present` - whether `window.location.hash` is non-empty.
- `data.has_key` - whether the URL fragment contains `key`.
- `data.standalone` - whether the app is running in standalone display mode.
- `data.online` - current `navigator.onLine` value.
- `data.visibility_state` - current `document.visibilityState`.
- `data.participant_name` - participant name, included after the client knows it.

Reconnect storage diagnostics may additionally include:

- `storage_accessible` - whether `localStorage` was accessible.
- `local_storage_length` - `localStorage.length` observed during inspection.
- `storage_key_present` - whether the reconnect storage record exists.
- `storage_record_length` - stored record length in bytes/chars.
- `storage_record_parseable` - whether the stored JSON was parsed successfully.
- `storage_record_updated_at` - `updatedAt` from the stored reconnect session.
- `stored_session_present` - whether a stored session with `chatId` was found.
- `stored_has_key` - whether the stored session has `roomKey`.
- `stored_has_reconnect_token` - whether the stored session has `reconnectToken`.
- `storage_error_name` / `storage_error_message` - storage access error details.
- `storage_parse_error_name` / `storage_parse_error_message` - JSON parse error details.

## Events

### Page Lifecycle

- `chat_join_page_start` - `joinchat` page started. Includes URL parameters,
  key source, and reconnect storage inspection.
- `chat_join_params_missing` - the page cannot continue because `id` or a room
  key is missing. For push opens, `#key` is expected to be absent, so this event
  must be interpreted together with reconnect storage fields.
- `chat_page_hide` - browser fired `pagehide`.
- `chat_before_unload` - browser fired `beforeunload`.
- `chat_visibility_change` - document visibility changed.

### Reconnect Storage

- `chat_reconnect_room_key_store_failed` - failed to save `roomKey` from the URL
  fragment into reconnect storage.
- `chat_join_reconnect_token_missing` - `roomKey` was restored from storage, but
  `reconnectToken` was absent, so automatic reconnect is blocked.
- `chat_reconnect_session_store_ok` - reconnect session was stored and verified
  by reading it back.
- `chat_reconnect_session_store_failed` - reconnect session storage or read-back
  verification failed. The client will retry.
- `chat_push_subscription_blocked_until_reconnect_session_stored` - the client
  has a push subscription but will not send it to the server until reconnect
  data is stored and verified.

### WebSocket And Join

- `chat_ws_connect_start` - WebSocket connection attempt started.
- `chat_ws_create_failed` - WebSocket object creation failed.
- `chat_ws_open` - WebSocket connection opened.
- `chat_ws_no_such_chat` - server rejected join because the chat does not exist.
- `chat_ws_chat_full` - server rejected join because the chat is full.
- `chat_ws_invalid_reconnect_token` - server rejected reconnect token.
- `chat_ws_error` - WebSocket emitted `error`.
- `chat_ws_close` - WebSocket closed.
- `chat_ws_connect_failed` - connect attempt failed before a successful open.
- `chat_ws_retry_scheduled` - reconnect retry was scheduled.
- `chat_ws_reconnect_deferred_hidden` - reconnect was deferred while the page
  was hidden.
- `chat_ws_reconnect_resumed_visible` - deferred reconnect resumed after the
  page became visible.
- `chat_manual_reconnect` - user manually requested reconnect.

### Crypto

- `chat_key_import_failed` - room key import failed.

### Push

- `chat_push_subscription_changed` - service worker reported a refreshed push
  subscription to the page.
- `chat_push_subscription_failed` - obtaining or refreshing push subscription
  failed.

There is currently no explicit event for opening the chat from a notification
click. If that signal is added, document the URL marker and the new event here.

### iOS Home Screen Prompt

- `chat_ios_home_prompt_shown` - iOS standalone/Home Screen prompt was shown.
- `chat_ios_home_prompt_skipped` - user chose to continue without iOS push setup.

### Local Leave

- `chat_leave_local` - user left the chat locally.
