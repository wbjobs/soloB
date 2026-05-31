defmodule Chatroom.MixProject do
  use Mix.Project

  def project do
    [
      app: :chatroom,
      version: "0.1.0",
      elixir: "~> 1.14",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps()
    ]
  end

  def application do
    [
      mod: {Chatroom.Application, []},
      extra_applications: [:logger, :runtime_tools, :mnesia]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      {:phoenix, "~> 1.7"},
      {:phoenix_pubsub, "~> 2.1"},
      {:jason, "~> 1.4"},
      {:plug_cowboy, "~> 2.6"},
      {:libcluster, "~> 3.3"},
      {:telemetry_metrics, "~> 0.6"},
      {:telemetry_poller, "~> 1.0"},
      {:ecto, "~> 3.11"}
    ]
  end

  defp aliases do
    [
      setup: ["deps.get"]
    ]
  end
end
