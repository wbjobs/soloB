import Config

config :chatroom, ChatroomWeb.Endpoint,
  url: [host: "example.com", port: 80],
  cache_static_manifest: "priv/static/cache_manifest.json"

config :logger,
  level: :info,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :serve_endpoints, true

import_config "prod.secret.exs"
