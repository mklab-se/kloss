# kloss container image: the single-file binary on a minimal base (no shell, non-root).
#
#   docker run -p 8080:8080 -e KLOSS_PASSWORD=... ghcr.io/mklab-se/kloss
#
# build-info.txt (written by hooks/prepackage.sh before `azd deploy`) holds the build that
# /healthz reports; without it the release version from package.json is reported.

FROM oven/bun:1 AS build
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY src ./src
COPY tsconfig.json ./
RUN bun build src/cli.ts --compile --minify --sourcemap --target=bun-linux-x64 --outfile /out/kloss
COPY build-info.tx[t] /out/
RUN touch /out/build-info.txt

FROM gcr.io/distroless/cc-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/mklab-se/kloss" \
      org.opencontainers.image.description="kloss: build models from klossar, live in 3D, through a REST API or MCP" \
      org.opencontainers.image.licenses="MIT"
COPY --from=build /out/kloss /usr/local/bin/kloss
COPY --from=build /out/build-info.txt /etc/kloss/build-info.txt
ENV KLOSS_HOST=0.0.0.0 \
    KLOSS_PORT=8080 \
    KLOSS_NO_UPDATE_CHECK=1 \
    KLOSS_BUILD_FILE=/etc/kloss/build-info.txt
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/kloss"]
CMD ["serve"]
