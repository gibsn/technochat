package typingusers

import (
	"sort"
	"sync"
	"time"

	"technochat/internal/chat/message"
)

type User struct {
	ID   int
	Name string
}

type TypingUsers struct {
	ttl       time.Duration
	mx        sync.RWMutex
	deadlines map[int]typingUser
}

type typingUser struct {
	name     string
	deadline time.Time
}

func New(ttl time.Duration) *TypingUsers {
	return &TypingUsers{
		ttl:       ttl,
		deadlines: make(map[int]typingUser),
	}
}

func (tu *TypingUsers) Refresh(user User, now time.Time) bool {
	tu.mx.Lock()
	defer tu.mx.Unlock()

	_, existed := tu.deadlines[user.ID]
	tu.deadlines[user.ID] = typingUser{
		name:     user.Name,
		deadline: now.Add(tu.ttl),
	}

	return !existed
}

func (tu *TypingUsers) Remove(userID int) bool {
	tu.mx.Lock()
	defer tu.mx.Unlock()

	if _, ok := tu.deadlines[userID]; !ok {
		return false
	}

	delete(tu.deadlines, userID)

	return true
}

func (tu *TypingUsers) Expire(now time.Time) bool {
	tu.mx.Lock()
	defer tu.mx.Unlock()

	changed := false

	for userID, user := range tu.deadlines {
		if now.Before(user.deadline) {
			continue
		}

		delete(tu.deadlines, userID)
		changed = true
	}

	return changed
}

func (tu *TypingUsers) Users() []message.TypingUser {
	tu.mx.RLock()
	defer tu.mx.RUnlock()

	users := make([]message.TypingUser, 0, len(tu.deadlines))

	for userID, user := range tu.deadlines {
		users = append(users, message.TypingUser{
			ID:        userID,
			Name:      user.name,
			ExpiresAt: user.deadline,
		})
	}

	sort.Slice(users, func(i, j int) bool {
		return users[i].ID < users[j].ID
	})

	return users
}

func UsersFor(users []message.TypingUser, recipientID int) []message.TypingUser {
	filtered := make([]message.TypingUser, 0, len(users))

	for _, user := range users {
		if user.ID == recipientID {
			continue
		}

		filtered = append(filtered, user)
	}

	return filtered
}

func (tu *TypingUsers) Len() int {
	tu.mx.RLock()
	defer tu.mx.RUnlock()

	return len(tu.deadlines)
}
