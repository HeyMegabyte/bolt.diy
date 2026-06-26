# social.projectsites.dev — Postiz social media scheduler on CF Workers Containers.
#
# License: AGPL-3.0 (gitroomhq/postiz-app). This is an isolated reference/transition
# service running as a black-box microservice. Do NOT copy or adapt any Postiz source
# code into proprietary modules — only the HTTP API surface is used from outside.
FROM ghcr.io/gitroomhq/postiz-app:latest

# 3000 = Postiz all-in-one HTTP (Next.js frontend + NestJS API behind nginx).
# The Container DO forwards all edge requests to this port.
EXPOSE 3000
