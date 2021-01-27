package typingusers

import (
	"time"
)

var startValue = 2
var tickerDuration = 2 * time.Second

type TypingUsers struct {
	refreshChan chan int
	TypingList  map[int]int
	updatesChan chan []int
}

func NewTypingUsers() TypingUsers {
	ts := TypingUsers{
		refreshChan: make(chan int, 10),
		TypingList:  make(map[int]int),
		updatesChan: make(chan []int),
	}

	go ts.handle()

	return ts
}

func (ts *TypingUsers) Subscribe() chan []int {
	return ts.updatesChan
}

func (ts *TypingUsers) Refresh(i int) {
	ts.refreshChan <- i
}

func (ts *TypingUsers) handle() {
	var diff bool
	ticker := time.NewTicker(tickerDuration)
	for {
		select {
		case <-ticker.C:
			diff = false
			for k, v := range ts.TypingList {
				if v > 0 {
					ts.TypingList[k]--
					if ts.TypingList[k] == 0 {
						diff = true
					}
				}
			}
			if diff {
				ts.updatesChan <- ts.prepUpdate()
			}
		case refr := <-ts.refreshChan:
			if ts.TypingList[refr] < startValue {
				ts.TypingList[refr] = startValue
				ts.updatesChan <- ts.prepUpdate()
			}
		}
	}
}

func (ts *TypingUsers) prepUpdate() []int {
	list := make([]int, len(ts.TypingList), len(ts.TypingList))
	listPtr := 0

	for k, v := range ts.TypingList {
		if v > 0 {
			list[listPtr] = k
			listPtr++
		}
	}
	return list[:listPtr]
}
