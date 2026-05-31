defmodule Chatroom.MnesiaAdapter do
  @moduledoc """
  Mnesia 数据库适配器
  """
  alias :mnesia, as: Mnesia

  def insert(room) do
    Mnesia.transaction(fn ->
      Mnesia.write(room)
    end)
    |> handle_transaction()
  end

  def get(id) do
    Mnesia.transaction(fn ->
      case Mnesia.read({Chatroom.Room, id}) do
        [room] -> room
        [] -> nil
      end
    end)
    |> handle_transaction()
  end

  def get_by_name(name) do
    Mnesia.transaction(fn ->
      Mnesia.match_object({Chatroom.Room, :_, name, :_, :_, :_})
    end)
    |> handle_transaction()
    |> List.first()
  end

  def all do
    Mnesia.transaction(fn ->
      Mnesia.match_object({Chatroom.Room, :_, :_, :_, :_, :_})
    end)
    |> handle_transaction()
  end

  def delete(id) do
    Mnesia.transaction(fn ->
      Mnesia.delete({Chatroom.Room, id})
    end)
    |> handle_transaction()
  end

  def update(room) do
    Mnesia.transaction(fn ->
      Mnesia.write(room)
    end)
    |> handle_transaction()
  end

  defp handle_transaction(result) do
    case result do
      {:atomic, val} -> {:ok, val}
      {:aborted, reason} -> {:error, reason}
    end
  end
end
