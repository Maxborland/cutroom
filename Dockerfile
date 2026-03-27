FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev \
  && npm install --include=optional --os=linux --cpu=x64 --no-save @rollup/rollup-linux-x64-gnu@4.57.1 @img/sharp-linux-x64@0.34.5 @img/sharp-libvips-linux-x64@1.2.4

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["npm", "run", "start"]
