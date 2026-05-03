package main

import (
	"fmt"
	"log"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func main() {
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		log.Fatalln("could not generate VAPID keys:", err)
	}

	fmt.Printf("VAPID_PUBLIC_KEY=%s\n", publicKey)
	fmt.Printf("VAPID_PRIVATE_KEY=%s\n", privateKey)
}
