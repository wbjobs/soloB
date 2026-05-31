defmodule Chatroom.Room.Server do
  @moduledoc """
  聊天室 GenServer，管理单个房间的状态
  使用 Registry 进行本地进程注册
  """
  use GenServer

  alias Chatroom.Presence

  @max_history 100

  defstruct [
    :room_id,
    :room_name,
    messages: [],
    users: %{},
    muted_users: MapSet.new(),
    kicked_users: MapSet.new()
  ]

  def start_link({room_id, room_name}) do
    GenServer.start_link(__MODULE__, {room_id, room_name}, name: via_tuple(room_id))
  end

  def via_tuple(room_id) do
    {:via, Registry, {Chatroom.Room.Registry, room_id}}
  end

  def join(room_id, user_id, user_info \\ %{}) do
    call(room_id, {:join, user_id, user_info})
  end

  def leave(room_id, user_id) do
    call(room_id, {:leave, user_id})
  end

  def add_message(room_id, message) do
    cast(room_id, {:add_message, message})
  end

  def send_message(room_id, user_id, content) do
    call(room_id, {:send_message, user_id, content})
  end

  def can_send_message?(room_id, user_id) do
    call(room_id, {:can_send_message, user_id})
  end

  def mute_user(room_id, admin_id, target_user_id, reason \\ nil) do
    call(room_id, {:mute_user, admin_id, target_user_id, reason})
  end

  def unmute_user(room_id, admin_id, target_user_id) do
    call(room_id, {:unmute_user, admin_id, target_user_id})
  end

  def kick_user(room_id, admin_id, target_user_id, reason \\ nil) do
    call(room_id, {:kick_user, admin_id, target_user_id, reason})
  end

  def is_muted?(room_id, user_id) do
    call(room_id, {:is_muted, user_id})
  end

  def is_kicked?(room_id, user_id) do
    call(room_id, {:is_kicked, user_id})
  end

  def get_messages(room_id) do
    call(room_id, :get_messages)
  end

  def get_users(room_id) do
    call(room_id, :get_users)
  end

  def get_muted_users(room_id) do
    call(room_id, :get_muted_users)
  end

  defp call(room_id, message) do
    case GenServer.whereis(via_tuple(room_id)) do
      nil -> {:error, :room_not_found}
      _ -> GenServer.call(via_tuple(room_id), message)
    end
  end

  defp cast(room_id, message) do
    case GenServer.whereis(via_tuple(room_id)) do
      nil -> {:error, :room_not_found}
      _ -> GenServer.cast(via_tuple(room_id), message)
    end
  end

  @impl true
  def init({room_id, room_name}) do
    IO.puts("[RoomServer] Starting room #{room_name} (#{room_id}) on #{Node.self()}")
    {:ok, %__MODULE__{room_id: room_id, room_name: room_name}}
  end

  @impl true
  def handle_call({:join, user_id, user_info}, _from, state) do
    if MapSet.member?(state.kicked_users, user_id) do
      {:reply, {:error, :kicked}, state}
    else
      user_info = Map.put(user_info, :joined_at, DateTime.utc_now())
      new_users = Map.put(state.users, user_id, user_info)

      topic = "room:#{state.room_name}"

      Presence.track(self(), topic, user_id, user_info)

      Phoenix.PubSub.broadcast(
        Chatroom.PubSub,
        topic,
        {:user_joined, %{user_id: user_id, user_info: user_info}}
      )

      IO.puts("[RoomServer] User #{user_id} joined room #{state.room_name} on #{Node.self()}")

      {:reply, :ok, %{state | users: new_users}}
    end
  end

  @impl true
  def handle_call({:leave, user_id}, _from, state) do
    new_users = Map.delete(state.users, user_id)
    topic = "room:#{state.room_name}"

    Presence.untrack(self(), topic, user_id)

    Phoenix.PubSub.broadcast(
      Chatroom.PubSub,
      topic,
      {:user_left, %{user_id: user_id}}
    )

    IO.puts("[RoomServer] User #{user_id} left room #{state.room_name} on #{Node.self()}")

    {:reply, :ok, %{state | users: new_users}}
  end

  @impl true
  def handle_call({:send_message, user_id, content}, _from, state) do
    if MapSet.member?(state.muted_users, user_id) do
      {:reply, {:error, :muted}, state}
    else
      message = %{
        id: Ecto.UUID.generate(),
        user_id: user_id,
        content: content,
        timestamp: DateTime.utc_now()
      }

      new_messages = Enum.take([message | state.messages], @max_history)

      topic = "room:#{state.room_name}"

      Phoenix.PubSub.broadcast(
        Chatroom.PubSub,
        topic,
        {:new_message, message}
      )

      {:reply, {:ok, message}, %{state | messages: new_messages}}
    end
  end

  @impl true
  def handle_call({:can_send_message, user_id}, _from, state) do
    can_send = not MapSet.member?(state.muted_users, user_id) and
               not MapSet.member?(state.kicked_users, user_id)
    {:reply, can_send, state}
  end

  @impl true
  def handle_call({:mute_user, _admin_id, target_user_id, reason}, _from, state) do
    if not Map.has_key?(state.users, target_user_id) do
      {:reply, {:error, :user_not_in_room}, state}
    else
      new_muted = MapSet.put(state.muted_users, target_user_id)
      topic = "room:#{state.room_name}"

      event = %{
        user_id: target_user_id,
        reason: reason,
        muted_at: DateTime.utc_now()
      }

      Phoenix.PubSub.broadcast(
        Chatroom.PubSub,
        topic,
        {:user_muted, event}
      )

      IO.puts("[RoomServer] User #{target_user_id} muted in room #{state.room_name}")

      {:reply, {:ok, event}, %{state | muted_users: new_muted}}
    end
  end

  @impl true
  def handle_call({:unmute_user, _admin_id, target_user_id}, _from, state) do
    new_muted = MapSet.delete(state.muted_users, target_user_id)
    topic = "room:#{state.room_name}"

    event = %{
      user_id: target_user_id,
      unmuted_at: DateTime.utc_now()
    }

    Phoenix.PubSub.broadcast(
      Chatroom.PubSub,
      topic,
      {:user_unmuted, event}
    )

    IO.puts("[RoomServer] User #{target_user_id} unmuted in room #{state.room_name}")

    {:reply, {:ok, event}, %{state | muted_users: new_muted}}
  end

  @impl true
  def handle_call({:kick_user, _admin_id, target_user_id, reason}, _from, state) do
    if not Map.has_key?(state.users, target_user_id) do
      {:reply, {:error, :user_not_in_room}, state}
    else
      new_kicked = MapSet.put(state.kicked_users, target_user_id)
      new_users = Map.delete(state.users, target_user_id)
      new_muted = MapSet.delete(state.muted_users, target_user_id)

      topic = "room:#{state.room_name}"

      Presence.untrack(self(), topic, target_user_id)

      event = %{
        user_id: target_user_id,
        reason: reason,
        kicked_at: DateTime.utc_now()
      }

      Phoenix.PubSub.broadcast(
        Chatroom.PubSub,
        topic,
        {:user_kicked, event}
      )

      IO.puts("[RoomServer] User #{target_user_id} kicked from room #{state.room_name}")

      {:reply, {:ok, event}, %{state | kicked_users: new_kicked, users: new_users, muted_users: new_muted}}
    end
  end

  @impl true
  def handle_call({:is_muted, user_id}, _from, state) do
    {:reply, MapSet.member?(state.muted_users, user_id), state}
  end

  @impl true
  def handle_call({:is_kicked, user_id}, _from, state) do
    {:reply, MapSet.member?(state.kicked_users, user_id), state}
  end

  @impl true
  def handle_call(:get_messages, _from, state) do
    {:reply, {:ok, Enum.reverse(state.messages)}, state}
  end

  @impl true
  def handle_call(:get_users, _from, state) do
    {:reply, {:ok, state.users}, state}
  end

  @impl true
  def handle_call(:get_muted_users, _from, state) do
    {:reply, {:ok, state.muted_users}, state}
  end

  @impl true
  def handle_cast({:add_message, message}, state) do
    new_messages = Enum.take([message | state.messages], @max_history)
    {:noreply, %{state | messages: new_messages}}
  end
end
