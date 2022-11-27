FROM golang:1.18

EXPOSE 8080

WORKDIR /go/src/technochat

COPY ./ ./

RUN make technochat
RUN find ./ ! -path "./bin*" ! -name "." ! -name ".." -delete

RUN groupadd -r technochat
RUN useradd -r -g technochat -s /bin/nologin technochat

USER technochat:technochat

CMD ["./bin/technochat", "-l", "0.0.0.0:8080"]
