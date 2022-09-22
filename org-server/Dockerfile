FROM node:16

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
EXPOSE ${PORT}

CMD [ "node", "server.js" ]