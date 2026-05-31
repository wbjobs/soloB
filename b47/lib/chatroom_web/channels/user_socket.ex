defmodule ChatroomWeb.UserSocket do
  use Phoenix.Socket

  channel "room:*", ChatroomWeb.RoomChannel

  @impl true
  def connect(%{"user_id" => user_id, "username" => username} = _params, socket, _connect_info) do
    socket =
      socket
      |> assign(:user_id, user_id)
      |> assign(:username, username)

    {:ok, socket}
  end

  def connect(_params, _socket, _connect_info) do
    :error
  end

  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.user_id}"
end
