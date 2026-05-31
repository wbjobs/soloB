defmodule Chatroom.Room do
  @moduledoc """
  聊天室元数据记录
  """
  defstruct [
    :id,
    :name,
    :creator_id,
    :created_at,
    :updated_at,
    admins: MapSet.new()
  ]

  @type t :: %__MODULE__{
    id: String.t(),
    name: String.t(),
    creator_id: String.t(),
    created_at: DateTime.t(),
    updated_at: DateTime.t(),
    admins: MapSet.t(String.t())
  }

  def new(attrs \\ %{}) do
    now = DateTime.utc_now()
    creator_id = attrs[:creator_id]

    admins =
      case attrs[:admins] do
        nil ->
          if creator_id, do: MapSet.new([creator_id]), else: MapSet.new()

        admins when is_list(admins) ->
          MapSet.new(admins)

        %MapSet{} = admins ->
          admins
      end

    %__MODULE__{
      id: attrs[:id] || Ecto.UUID.generate(),
      name: attrs[:name] || "lobby",
      creator_id: creator_id,
      created_at: now,
      updated_at: now,
      admins: admins
    }
  end

  def add_admin(%__MODULE__{} = room, user_id) do
    %{room | admins: MapSet.put(room.admins, user_id), updated_at: DateTime.utc_now()}
  end

  def remove_admin(%__MODULE__{} = room, user_id) do
    if user_id == room.creator_id do
      room
    else
      %{room | admins: MapSet.delete(room.admins, user_id), updated_at: DateTime.utc_now()}
    end
  end

  def is_admin?(%__MODULE__{} = room, user_id) do
    MapSet.member?(room.admins, user_id)
  end

  def to_record(%__MODULE__{} = room) do
    {
      __MODULE__,
      room.id,
      room.name,
      room.creator_id,
      room.created_at,
      room.updated_at,
      room.admins
    }
  end

  def from_record({__MODULE__, id, name, creator_id, created_at, updated_at, admins}) do
    %__MODULE__{
      id: id,
      name: name,
      creator_id: creator_id,
      created_at: created_at,
      updated_at: updated_at,
      admins: admins
    }
  end

  def from_record({__MODULE__, id, name, creator_id, created_at, updated_at}) do
    admins = if creator_id, do: MapSet.new([creator_id]), else: MapSet.new()

    %__MODULE__{
      id: id,
      name: name,
      creator_id: creator_id,
      created_at: created_at,
      updated_at: updated_at,
      admins: admins
    }
  end
end
