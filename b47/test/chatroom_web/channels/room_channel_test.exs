defmodule ChatroomWeb.RoomChannelTest do
  use ChatroomWeb.ChannelCase

  setup do
    {:ok, _, socket} =
      socket(ChatroomWeb.UserSocket, "user_id", %{user_id: "user1", username: "Alice"})
      |> subscribe_and_join(ChatroomWeb.RoomChannel, "room:lobby")

    {:ok, socket: socket}
  end

  test "ping replies with status ok", %{socket: socket} do
    ref = push(socket, "new_message", %{"content" => "hello"})
    assert_reply ref, :ok
  end

  test "shout broadcasts to room:lobby", %{socket: socket} do
    push(socket, "new_message", %{"content" => "hello"})
    assert_broadcast "new_message", %{content: "hello"}
  end
end
