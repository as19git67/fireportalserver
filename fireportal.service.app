# copy to /etc/systemd/system
# systemctl enable fireportal
# systemctl start fireportal
[Unit]
Description=Fireportal Express Server
Wants=network.target
After=network.target

[Service]
ExecStart=/usr/bin/node /home/alarm/fireportalserver/server.js
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
WorkingDirectory=/home/alarm/fireportalserver
Restart=on-failure
#Restart=always
#StandardOutput=/var/log/fireportalserver.log
#StandardError=/var/log/fireportalserver.log
SyslogIdentifier=fireportalserver
User=alarm
Group=alarm
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
