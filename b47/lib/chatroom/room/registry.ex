defmodule Chatroom.Room.Registry do
  @moduledoc """
  聊天室进程注册表
  """
  use Registry,
    keys: :unique,
    name: __MODULE__
end
