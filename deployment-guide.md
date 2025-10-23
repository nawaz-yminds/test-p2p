# Deployment Guide (Ubuntu + Nginx + PM2)

Deploy the full app (client + signaling server) on one origin so the browser can access camera and WebRTC reliably over HTTPS.

## Prerequisites
- Ubuntu server with sudo
- Node.js 18+ and npm
- Nginx installed (`sudo apt install nginx`)
- PM2 installed globally: `sudo npm i -g pm2`
- Domain pointed (A/AAAA) to the server (p2p.employability.ai)
- Certbot for TLS: `sudo apt install certbot python3-certbot-nginx`

## 1) Get the code on the server
```
sudo mkdir -p /var/www/test-p2p && sudo chown -R $USER:$USER /var/www/test-p2p
cd /var/www/test-p2p
git clone <YOUR_REPO_URL> .
```

## 2) Build the client and server
```
cd client
npm ci
# IMPORTANT: For production, delete client/.env so the app uses same-origin WebSocket; or set VITE_SOCKET_URL to your HTTPS domain.
rm -f .env
# If you prefer to keep an env, build with:
# VITE_SOCKET_URL=https://p2p.employability.ai npm run build
npm run build

cd ../server
npm ci
npm run build
```

## 3) Run the server with PM2
The server serves the built client and Socket.IO on the same origin.
```
cd /var/www/test-p2p/server
PORT=3001 NODE_ENV=production pm2 start dist/index.js --name test-p2p
pm2 save
pm2 startup  # follow the printed instruction once to enable on boot
```

## 4) Configure Nginx (reverse proxy)
Create a site config for p2p.employability.ai.
```
sudo tee /etc/nginx/sites-available/test-p2p >/dev/null <<'CONF'
server {
  listen 80;
  server_name p2p.employability.ai;

  # WebSocket upgrade for Socket.IO
  location /socket.io/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # App (static + API same origin)
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
CONF

sudo ln -sf /etc/nginx/sites-available/test-p2p /etc/nginx/sites-enabled/test-p2p
sudo nginx -t && sudo systemctl reload nginx
```

## 5) Enable HTTPS (required for mobile camera)
```
sudo certbot --nginx -d p2p.employability.ai
```
Certbot updates Nginx for HTTPS automatically.

## 6) Verify
- Open https://p2p.employability.ai on desktop → click "Start Webcam"
- Copy the share URL and open it on the phone → allow camera → remote feed appears on desktop (right pane)

## 7) Deploy updates
```
cd /var/www/test-p2p
git pull
cd client && npm ci && npm run build
cd ../server && npm ci && npm run build
pm2 restart test-p2p
```

## Notes
- For LAN-only tests without a public domain, mobile browsers still require HTTPS for camera; use a tunnel (ngrok/cloudflared) if needed.
- If you change the server port, update Nginx `proxy_pass` targets accordingly.
