MODULE_NAME=technochat

TEST_FILES = $(shell find -L * -name '*_test.go' -not -path "vendor/*")
TEST_PACKAGES = $(dir $(addprefix $(MODULE_NAME)/,$(TEST_FILES)))

VET_FILES = $(shell find -L * -name '*.go' -not -path "vendor/*")
VET_PACKAGES = $(dir $(addprefix $(MODULE_NAME)/,$(VET_FILES)))

TARGET_BRANCH ?= master

all: technochat

install: technochat
	go install ./...

technochat:
	go build -mod vendor -o bin/technochat technochat

bin/golangci-lint:
	@echo "getting golangci-lint for $$(uname -m)/$$(uname -s)"
	curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s v1.45.2

lint: bin/golangci-lint
	bin/golangci-lint run -v -c golangci.yml --new-from-rev=$(TARGET_BRANCH)

test:
	go test -v $(TEST_PACKAGES)

integration-test:
	# go test	-v -count=1 -timeout=10s -tags='integration_tests' ./...
	go test	-count=1 -timeout=10s -tags='integration_tests' ./...

install_autodeploy:
	mkdir -p /opt/technochat
	cp -pr ./* /opt/technochat
	cp ./dist/autodeploy.sh /opt/technochat/
	chmod +x /opt/technochat/autodeploy.sh
	cp ./dist/autodeploy_technochat.service /etc/systemd/system/
	cp ./dist/autodeploy_technochat.timer /etc/systemd/system/
	systemctl daemon-reload
	systemctl enable --now autodeploy_technochat.timer

vet:
	go vet $(VET_PACKAGES)

clean:
	rm -rf bin/


.PHONY: all clean test install vet technochat lint install_autodeploy
