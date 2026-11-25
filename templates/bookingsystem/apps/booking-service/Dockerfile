FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY proto ./proto
USER node
EXPOSE 3000
CMD ["node", "src/main.ts"]
