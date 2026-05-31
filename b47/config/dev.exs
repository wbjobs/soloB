import Config

port = String.to_integer(System.get_env("PORT") || "4000")

config :chatroom, ChatroomWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: port],
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base: "dev_secret_key_base_dev_secret_key_base_dev_secret_key_base",
  watchers: []

config :logger, :console,
  format: "[$level] $message\n",
  level: :info

config :phoenix, :stacktrace_depth, 20

config :phoenix, :plug_init_mode, :runtime

cluster_strategy = System.get_env("CLUSTER_STRATEGY") || "gossip"

case cluster_strategy do
  "gossip" ->
    config :libcluster,
      topologies: [
        chatroom_cluster: [
          strategy: Cluster.Strategy.Gossip,
          config: [
            port: String.to_integer(System.get_env("GOSSIP_PORT") || "45892"),
            if_addr: {0, 0, 0, 0},
            multicast_if: {0, 0, 0, 0},
            multicast_addr: {230, 1, 1, 251},
            multicast_ttl: 1,
            secret: "chatroom_cluster_secret"
          ]
        ]
      ]

  "epmd" ->
    node_name = System.get_env("NODE_NAME") || "chatroom"
    node_host = System.get_env("NODE_HOST") || "127.0.0.1"

    config :libcluster,
      topologies: [
        chatroom_cluster: [
          strategy: Cluster.Strategy.Epmd,
          config: [
            hosts:
              case System.get_env("CLUSTER_NODES") do
                nil ->
                  [:"#{node_name}@#{node_host}"]

                nodes_str ->
                  nodes_str
                  |> String.split(",")
                  |> Enum.map(&String.to_atom/1)
              end
          ]
        ]
      ]

  _ ->
    config :libcluster, topologies: []
end
