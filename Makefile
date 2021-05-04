MODULE_NAME=technochat

TEST_FILES = $(shell find -L * -name '*_test.go' -not -path "vendor/*")
TEST_PACKAGES = $(dir $(addprefix $(MODULE_NAME)/,$(TEST_FILES)))

VET_FILES = $(shell find -L * -name '*.go' -not -path "vendor/*")
VET_PACKAGES = $(dir $(addprefix $(MODULE_NAME)/,$(VET_FILES)))

all: technochat

install: technochat
	go install ./...

technochat:
	go build -mod vendor -o bin/technochat technochat

bin/golangci-lint:
	@echo "getting golangci-lint for $$(uname -m)/$$(uname -s)"
	curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s v1.29.0

lint: bin/golangci-lint
	bin/golangci-lint run -v -c golangci.yml --new-from-rev=$(TARGET_BRANCH)

test:
	go test -v $(TEST_PACKAGES)

vet:
	go vet $(VET_PACKAGES)

clean:
	rm -rf bin/
	rm -rf pkg/


.PHONY: all clean test install vet technochat lint lint_ci
