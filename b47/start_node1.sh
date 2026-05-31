#!/bin/bash
echo "========================================"
echo "Starting Chatroom Node 1 (Port 4000)"
echo "========================================"
echo ""

export MIX_ENV=dev
export PORT=4000
export GOSSIP_PORT=45892
export CLUSTER_STRATEGY=gossip

iex --name node1@127.0.0.1 --cookie chatroom_secret -S mix phx.server
