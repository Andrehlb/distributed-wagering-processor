FROM oven/bun:1.4.4
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
COPY scripts ./scripts
EXPOSE 3000
CMD ["bun", "src/main.ts"]
