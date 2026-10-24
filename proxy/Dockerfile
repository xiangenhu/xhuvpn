FROM node:22-slim
WORKDIR /proxy
COPY proxy/package*.json ./
RUN npm ci --omit=dev
COPY proxy/server.js ./server.js
USER node
ENV PORT=8443
EXPOSE 8443
CMD ["node","server.js"]
