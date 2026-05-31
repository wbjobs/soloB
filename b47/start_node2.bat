@echo off
echo ========================================
echo Starting Chatroom Node 2 (Port 4001)
echo ========================================
echo.

set MIX_ENV=dev
set PORT=4001
set GOSSIP_PORT=45892
set CLUSTER_STRATEGY=gossip

iex --name node2@127.0.0.1 --cookie chatroom_secret -S mix phx.server
