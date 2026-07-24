FROM nocodb/nocodb:2026.06.2
# Bundle CA certificates — CF Firecracker microVMs lack /etc/ssl/certs.
# NocoDB image is Alpine-based, so use apk not apt.
RUN apk add --no-cache ca-certificates
ENV DEPLOY=standard-4
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
