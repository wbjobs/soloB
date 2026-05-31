#!/bin/bash
echo "========================================"
echo "Starting Chatroom Node 2 (Port 4001)"
echo "========================================"
echo ""

export MIX_ENV=dev
export PORT=4001
export GOSSIP_PORT=45892
export CLUSTER_STRATEGY=gossip

iex --name node2@127.0.0.1 --cookie chatroom_secret -S mix phx.server
