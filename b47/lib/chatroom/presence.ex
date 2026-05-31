defmodule Chatroom.Presence do
  @moduledoc """
  Phoenix Presence 模块，用于追踪在线用户
  """
  use Phoenix.Presence,
    otp_app: :chatroom,
    pubsub_server: Chatroom.PubSub

  @doc """
  从 Presence 结果中提取用户列表
  """
  def list_users(topic) do
    list(topic)
    |> Enum.map(fn {user_id, %{metas: metas}} ->
      meta = List.first(metas)
      {user_id, meta}
    end)
    |> Map.new()
  end
end
