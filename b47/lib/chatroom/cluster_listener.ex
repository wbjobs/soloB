defmodule Chatroom.ClusterListener do
  @moduledoc """
  监听 Erlang 集群节点连接事件，当新节点加入时同步 Mnesia 表
  """
  use GenServer

  alias :mnesia, as: Mnesia

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  end

  @impl true
  def init(_) do
    :net_kernel.monitor_nodes(true)
    {:ok, nil}
  end

  @impl true
  def handle_info({:nodeup, node}, state) do
    IO.puts("[Cluster] Node connected: #{node}")
    sync_mnesia_to_node(node)
    {:noreply, state}
  end

  @impl true
  def handle_info({:nodedown, node}, state) do
    IO.puts("[Cluster] Node disconnected: #{node}")
    {:noreply, state}
  end

  @impl true
  def handle_info(_msg, state) do
    {:noreply, state}
  end

  defp sync_mnesia_to_node(new_node) do
    case Mnesia.change_config(:extra_db_nodes, [new_node]) do
      {:ok, _} ->
        IO.puts("[Mnesia] Successfully connected to #{new_node}")
        ensure_tables_replicated(new_node)

      {:error, reason} ->
        IO.puts("[Mnesia] Failed to connect to #{new_node}: #{inspect(reason)}")
    end
  end

  defp ensure_tables_replicated(node) do
    tables = [:schema, Chatroom.Room]

    for table <- tables do
      case Mnesia.add_table_copy(table, node, :disc_copies) do
        {:atomic, :ok} ->
          IO.puts("[Mnesia] Table #{table} replicated to #{node}")

        {:aborted, {:already_exists, _, _}} ->
          IO.puts("[Mnesia] Table #{table} already exists on #{node}")

        {:aborted, reason} ->
          IO.puts("[Mnesia] Failed to replicate #{table} to #{node}: #{inspect(reason)}")
      end
    end

    Mnesia.wait_for_tables(tables, 5000)
  end
end
