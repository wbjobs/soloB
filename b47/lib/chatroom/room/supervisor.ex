defmodule Chatroom.Room.Supervisor do
  @moduledoc """
  聊天室动态监督树
  """
  use DynamicSupervisor

  alias Chatroom.Room.Server

  def start_link(_opts) do
    DynamicSupervisor.start_link(__MODULE__, nil, name: __MODULE__)
  end

  @impl true
  def init(_) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  def ensure_room_started(room_id, room_name) do
    case start_room(room_id, room_name) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      {:error, reason} -> {:error, reason}
    end
  end

  defp start_room(room_id, room_name) do
    spec = %{
      id: {Server, room_id},
      start: {Server, :start_link, [{room_id, room_name}]},
      restart: :permanent,
      shutdown: 5000,
      type: :worker
    }

    DynamicSupervisor.start_child(__MODULE__, spec)
  end
end
