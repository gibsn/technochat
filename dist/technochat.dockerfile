FROM golang:1.13

EXPOSE 8080

WORKDIR /go/src/technochat

COPY Makefile .
COPY ./ ./

RUN make technochat

RUN groupadd -r technochat
RUN useradd -r -g technochat -s /bin/nologin technochat

USER technochat:technochat

CMD ["./bin/technochat", "-l", "0.0.0.0:8080"]
