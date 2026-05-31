defmodule Chatroom.RoomTest do
  use ExUnit.Case
  doctest Chatroom.Room

  test "creates a new room with default values" do
    room = Chatroom.Room.new(name: "test", creator_id: "user1")
    assert room.name == "test"
    assert room.creator_id == "user1"
    assert is_binary(room.id)
    assert room.created_at != nil
  end

  test "converts room to mnesia record and back" do
    room = Chatroom.Room.new(name: "lobby", creator_id: "user1")
    record = Chatroom.Room.to_record(room)
    decoded = Chatroom.Room.from_record(record)
    assert decoded.id == room.id
    assert decoded.name == room.name
  end
end
