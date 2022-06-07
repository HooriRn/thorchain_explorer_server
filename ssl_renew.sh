#!/bin/bash

DOCKER="/usr/bin/docker"

cd /root/devs/explorer_server 
$DOCKER compose run certbot renew --dry-run && $COMPOSE kill -s SIGHUP webserver
$DOCKER system prune -af
