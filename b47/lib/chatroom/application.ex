defmodule Chatroom.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    topologies = Application.get_env(:libcluster, :topologies, [])
    IO.puts("[Application] Starting with libcluster topologies: #{inspect(topologies)}")
    IO.puts("[Application] Node name: #{Node.self()}")

    children = [
      {Phoenix.PubSub, name: Chatroom.PubSub},
      Chatroom.Presence,
      Chatroom.Room.Registry,
      {Chatroom.Room.Supervisor, []},
      Chatroom.ClusterListener,
      Chatroom.Repo,
      {Cluster.Supervisor, [topologies, [name: Chatroom.ClusterSupervisor]]},
      ChatroomWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Chatroom.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    ChatroomWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
