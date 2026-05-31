defmodule ChatroomWeb.RoomChannel do
  use ChatroomWeb, :channel

  alias Chatroom.Room
  alias Chatroom.Room.Server
  alias Chatroom.Room.Supervisor

  @impl true
  def join("room:" <> room_name, _payload, socket) do
    user_id = socket.assigns.user_id
    username = socket.assigns.username

    case ensure_room_exists(room_name, user_id) do
      {:ok, room} ->
        {:ok, _pid} = Supervisor.ensure_room_started(room.id, room_name)

        user_info = %{username: username, online_at: System.system_time(:second)}

        case Server.join(room.id, user_id, user_info) do
          :ok ->
            send(self(), :after_join)

            is_admin = Room.is_admin?(room, user_id)

            socket =
              socket
              |> assign(:room_id, room.id)
              |> assign(:room_name, room_name)
              |> assign(:room, room)
              |> assign(:is_admin, is_admin)

            {:ok, %{
              room_id: room.id,
              room_name: room_name,
              node: Node.self(),
              is_admin: is_admin
            }, socket}

          {:error, :kicked} ->
            {:error, %{reason: "You have been kicked from this room"}}
        end

      {:error, reason} ->
        {:error, %{reason: inspect(reason)}}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    room_id = socket.assigns.room_id
    room_name = socket.assigns.room_name
    topic = "room:#{room_name}"

    {:ok, messages} = Server.get_messages(room_id)
    online_users = Presence.list(topic)

    push(socket, "presence_state", online_users)

    {:ok, _} =
      Presence.track(socket, socket.assigns.user_id, %{
        username: socket.assigns.username,
        online_at: System.system_time(:second),
        node: Node.self(),
        is_admin: socket.assigns.is_admin
      })

    push(socket, "message_history", %{messages: messages})

    {:noreply, socket}
  end

  @impl true
  def handle_info({:user_muted, event}, socket) do
    broadcast!(socket, "user_muted", event)
    {:noreply, socket}
  end

  @impl true
  def handle_info({:user_unmuted, event}, socket) do
    broadcast!(socket, "user_unmuted", event)
    {:noreply, socket}
  end

  @impl true
  def handle_info({:user_kicked, event}, socket) do
    if event.user_id == socket.assigns.user_id do
      push(socket, "you_were_kicked", %{reason: event.reason})
      Process.send_after(self(), :disconnect, 100)
    else
      broadcast!(socket, "user_kicked", event)
    end

    {:noreply, socket}
  end

  @impl true
  def handle_info(:disconnect, socket) do
    {:stop, {:shutdown, :kicked}, socket}
  end

  @impl true
  def handle_in("new_message", %{"content" => content}, socket) do
    user_id = socket.assigns.user_id
    room_id = socket.assigns.room_id

    case Server.is_muted?(room_id, user_id) do
      true ->
        {:reply, {:error, %{reason: "You are muted and cannot send messages"}}, socket}

      false ->
        username = socket.assigns.username
        room_name = socket.assigns.room_name
        topic = "room:#{room_name}"

        message = %{
          id: Ecto.UUID.generate(),
          user_id: user_id,
          username: username,
          content: content,
          timestamp: DateTime.utc_now(),
          node: Node.self()
        }

        Server.add_message(room_id, message)

        broadcast!(socket, "new_message", message)

        Phoenix.PubSub.broadcast!(
          Chatroom.PubSub,
          topic,
          {:new_message, message}
        )

        {:reply, :ok, socket}
    end
  end

  @impl true
  def handle_in("mute_user", %{"user_id" => target_user_id, "reason" => reason}, socket) do
    do_mute_user(socket, target_user_id, reason)
  end

  @impl true
  def handle_in("mute_user", %{"user_id" => target_user_id}, socket) do
    do_mute_user(socket, target_user_id, nil)
  end

  @impl true
  def handle_in("unmute_user", %{"user_id" => target_user_id}, socket) do
    do_unmute_user(socket, target_user_id)
  end

  @impl true
  def handle_in("kick_user", %{"user_id" => target_user_id, "reason" => reason}, socket) do
    do_kick_user(socket, target_user_id, reason)
  end

  @impl true
  def handle_in("kick_user", %{"user_id" => target_user_id}, socket) do
    do_kick_user(socket, target_user_id, nil)
  end

  @impl true
  def terminate(_reason, socket) do
    room_id = socket.assigns.room_id
    user_id = socket.assigns.user_id

    Server.leave(room_id, user_id)

    :ok
  end

  defp do_mute_user(socket, target_user_id, reason) do
    if not socket.assigns.is_admin do
      {:reply, {:error, %{reason: "Only admins can mute users"}}, socket}
    else
      room_id = socket.assigns.room_id
      room_name = socket.assigns.room_name
      topic = "room:#{room_name}"

      case Server.mute_user(room_id, socket.assigns.user_id, target_user_id, reason) do
        {:ok, event} ->
          admin_info = %{
            admin_id: socket.assigns.user_id,
            admin_username: socket.assigns.username
          }

          event = Map.put(event, :admin, admin_info)

          broadcast!(socket, "user_muted", event)

          Phoenix.PubSub.broadcast!(
            Chatroom.PubSub,
            topic,
            {:user_muted, event}
          )

          {:reply, :ok, socket}

        {:error, :user_not_in_room} ->
          {:reply, {:error, %{reason: "User not in room"}}, socket}

        {:error, reason} ->
          {:reply, {:error, %{reason: inspect(reason)}}, socket}
      end
    end
  end

  defp do_unmute_user(socket, target_user_id) do
    if not socket.assigns.is_admin do
      {:reply, {:error, %{reason: "Only admins can unmute users"}}, socket}
    else
      room_id = socket.assigns.room_id
      room_name = socket.assigns.room_name
      topic = "room:#{room_name}"

      case Server.unmute_user(room_id, socket.assigns.user_id, target_user_id) do
        {:ok, event} ->
          admin_info = %{
            admin_id: socket.assigns.user_id,
            admin_username: socket.assigns.username
          }

          event = Map.put(event, :admin, admin_info)

          broadcast!(socket, "user_unmuted", event)

          Phoenix.PubSub.broadcast!(
            Chatroom.PubSub,
            topic,
            {:user_unmuted, event}
          )

          {:reply, :ok, socket}

        {:error, reason} ->
          {:reply, {:error, %{reason: inspect(reason)}}, socket}
      end
    end
  end

  defp do_kick_user(socket, target_user_id, reason) do
    if not socket.assigns.is_admin do
      {:reply, {:error, %{reason: "Only admins can kick users"}}, socket}
    else
      room_id = socket.assigns.room_id
      room_name = socket.assigns.room_name
      topic = "room:#{room_name}"

      case Server.kick_user(room_id, socket.assigns.user_id, target_user_id, reason) do
        {:ok, event} ->
          admin_info = %{
            admin_id: socket.assigns.user_id,
            admin_username: socket.assigns.username
          }

          event = Map.put(event, :admin, admin_info)

          broadcast!(socket, "user_kicked", event)

          Phoenix.PubSub.broadcast!(
            Chatroom.PubSub,
            topic,
            {:user_kicked, event}
          )

          {:reply, :ok, socket}

        {:error, :user_not_in_room} ->
          {:reply, {:error, %{reason: "User not in room"}}, socket}

        {:error, reason} ->
          {:reply, {:error, %{reason: inspect(reason)}}, socket}
      end
    end
  end

  defp ensure_room_exists(room_name, creator_id) do
    case Chatroom.MnesiaAdapter.get_by_name(room_name) do
      nil ->
        room = Room.new(name: room_name, creator_id: creator_id)
        record = Room.to_record(room)

        case Chatroom.MnesiaAdapter.insert(record) do
          {:ok, _} ->
            IO.puts("[Room] Created new room: #{room_name} by #{creator_id}")
            {:ok, room}

          {:error, reason} ->
            {:error, reason}
        end

      record ->
        {:ok, Room.from_record(record)}
    end
  end
end
