@echo off
echo ========================================
echo Starting Chatroom Node 1 (Port 4000)
echo ========================================
echo.

set MIX_ENV=dev
set PORT=4000
set GOSSIP_PORT=45892
set CLUSTER_STRATEGY=gossip

iex --name node1@127.0.0.1 --cookie chatroom_secret -S mix phx.server
