FROM golang:1.24-alpine AS builder

ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
RUN apk add --no-cache git
RUN git clone --branch "${MINIO_VERSION}" --depth 1 https://github.com/minio/minio.git /src/minio
WORKDIR /src/minio
RUN LDFLAGS="$(go run buildscripts/gen-ldflags.go)" \
 && CGO_ENABLED=0 GOOS=linux go build -tags kqueue -trimpath --ldflags "${LDFLAGS}" -o /out/minio

FROM alpine:3.22
RUN apk add --no-cache ca-certificates curl
COPY --from=builder /out/minio /usr/local/bin/minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
