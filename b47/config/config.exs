import Config

config :chatroom,
  ecto_repos: [Chatroom.Repo],
  generators: [binary_id: true]

config :chatroom, Chatroom.Repo, adapter: Chatroom.MnesiaAdapter

config :chatroom, ChatroomWeb.Endpoint,
  url: [host: "localhost"],
  render_errors: [
    formats: [json: ChatroomWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Chatroom.PubSub,
  live_view: [signing_salt: "chatroom_secret_salt"]

config :chatroom, Chatroom.Presence,
  pubsub_server: Chatroom.PubSub,
  presence: Chatroom.Presence

config :libcluster,
  topologies: [
    chatroom_cluster: [
      strategy: Cluster.Strategy.Gossip,
      config: [
        port: 45892,
        if_addr: "0.0.0.0",
        multicast_if: "0.0.0.0",
        multicast_addr: "230.1.1.251",
        multicast_ttl: 1,
        secret: "chatroom_cluster_secret"
      ]
    ]
  ]

config :chatroom, :cluster_topologies, Application.get_env(:libcluster, :topologies, [])

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
