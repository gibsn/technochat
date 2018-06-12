FROM golang:1.10

EXPOSE 8080

WORKDIR /go/src/technochat

COPY Makefile .
COPY src ./src
COPY vendor ./vendor
COPY static ./static

RUN make install

RUN cp -r ./static /

RUN groupadd -r technochat
RUN useradd -r -g technochat -s /bin/nologin technochat

USER technochat:technochat

CMD ["technochat", "-l", "0.0.0.0:8080"]