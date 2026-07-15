FROM node:20-alpine

WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
COPY data ./data

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Asia/Shanghai
EXPOSE 3000

CMD ["node", "server.mjs"]
