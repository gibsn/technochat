GOPATH := $(GOPATH):$(PWD):$(PWD)/vendor
export GOPATH

PATH := $(PWD)/bin:$(PATH)
export PATH


all: technochat

install: technochat
	go install ./...

technochat: bin/gb
	gb build technochat

bin/gb:
	go build -o bin/gb github.com/constabulary/gb/cmd/gb

vet:
	go tool vet ./src

clean:
	rm -rf bin/
	rm -rf pkg/
	rm -rf vendor/pkg


.PHONY: all clean
