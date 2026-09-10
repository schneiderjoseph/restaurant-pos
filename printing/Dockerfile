# Node Alpine for the ESC/POS print server.
FROM node:20-alpine

# eudev-libs -> libudev.so.1 required by node_modules/usb for USB access.
# libc6-compat -> sharp's prebuilt musl binary links against it.
# No build toolchain needed: image processing is sharp (prebuilt from npm),
# not node-canvas (removed - it needed cairo/pango + a network compile).
RUN apk add --no-cache eudev-libs libc6-compat

WORKDIR /app

ENV PRINT_PORT=3132
ENV PRINT_HOST=0.0.0.0
EXPOSE 3132

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "server.js"]
