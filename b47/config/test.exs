import Config

config :chatroom, ChatroomWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "test_secret_key_base_test_secret_key_base_test_secret_key_base",
  server: false

config :logger, level: :warning
