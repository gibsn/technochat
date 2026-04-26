MODULE_NAME=technochat

TEST_FILES = $(shell find -L * -name '*_test.go' -not -path "vendor/*")
TEST_PACKAGES = $(dir $(addprefix $(MODULE_NAME)/,$(TEST_FILES)))

VET_FILES = $(shell find -L * -name '*.go' -not -path "vendor/*")
VET_PACKAGES = $(dir $(addprefix $(MODULE_NAME)/,$(VET_FILES)))

TARGET_BRANCH ?= master
GO_BUILD_FLAGS ?= -buildvcs=false
UI_TEST_DEPS = ui-tests/node_modules/.package-lock.json

all: technochat

install: lint go-tests ui-tests technochat
	go install $(GO_BUILD_FLAGS) ./...

technochat:
	go build $(GO_BUILD_FLAGS) -mod vendor -o bin/technochat ./cmd/technochat

bin/golangci-lint:
	@echo "building golangci-lint v1.64.5 with $$(go env GOVERSION)"
	GOBIN=$(CURDIR)/bin go install github.com/golangci/golangci-lint/cmd/golangci-lint@v1.64.5

lint: bin/golangci-lint
	bin/golangci-lint run -v -c golangci.yml --new-from-rev=$(TARGET_BRANCH)

go-tests:
	go test -v $(TEST_PACKAGES)

$(UI_TEST_DEPS): ui-tests/package-lock.json ui-tests/package.json
	npm --prefix ui-tests ci

ui-unit-tests: $(UI_TEST_DEPS)
	npm --prefix ui-tests run ui-unit-test

ui-e2e-tests: $(UI_TEST_DEPS)
	npm --prefix ui-tests run ui-e2e-test

ui-tests: ui-unit-tests ui-e2e-tests

integration-tests:
	# go test	-v -count=1 -timeout=10s -tags='integration_tests' ./...
	go test	-count=1 -timeout=10s -tags='integration_tests' ./...

test: go-tests integration-tests ui-tests

install_autodeploy:
	mkdir -p /opt/technochat
	cp -pr . /opt/technochat
	chmod +x /opt/technochat/dist/autodeploy.sh
	cp ./dist/autodeploy_technochat.service /etc/systemd/system/
	cp ./dist/autodeploy_technochat.timer /etc/systemd/system/
	systemctl daemon-reload
	systemctl enable --now autodeploy_technochat.timer

vet:
	go vet $(VET_PACKAGES)

clean:
	rm -rf bin/
	rm -rf ui-tests/node_modules


.PHONY: all clean test go-tests ui-unit-tests ui-e2e-tests ui-tests integration-tests install vet technochat lint install_autodeploy
