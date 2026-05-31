defmodule Chatroom.Repo do
  @moduledoc """
  Mnesia 仓库模块 - 处理数据库初始化和集群同步
  """
  use GenServer

  alias :mnesia, as: Mnesia

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  end

  @impl true
  def init(_) do
    ensure_mnesia_running()
    {:ok, nil}
  end

  defp ensure_mnesia_running do
    case Mnesia.start() do
      :ok ->
        IO.puts("[Mnesia] Mnesia started on #{node()}")

      {:error, {:already_started, _}} ->
        IO.puts("[Mnesia] Mnesia already running on #{node()}")

      {:error, reason} ->
        raise "Failed to start Mnesia: #{inspect(reason)}"
    end

    setup_mnesia()
  end

  defp setup_mnesia do
    existing_nodes = Mnesia.system_info(:db_nodes)

    if length(existing_nodes) > 1 or (length(existing_nodes) == 1 and hd(existing_nodes) != node()) do
      IO.puts("[Mnesia] Joining existing cluster with nodes: #{inspect(existing_nodes)}")
      join_existing_cluster(existing_nodes)
    else
      IO.puts("[Mnesia] Setting up new schema on #{node()}")
      setup_new_schema()
    end

    ensure_local_tables()
  end

  defp join_existing_cluster(existing_nodes) do
    remote_nodes = existing_nodes -- [node()]

    if length(remote_nodes) > 0 do
      case Mnesia.change_config(:extra_db_nodes, remote_nodes) do
        {:ok, _} ->
          IO.puts("[Mnesia] Successfully joined cluster")
          copy_tables_from_cluster()

        {:error, reason} ->
          IO.puts("[Mnesia] Failed to join cluster: #{inspect(reason)}, setting up local schema")
          setup_new_schema()
      end
    else
      setup_new_schema()
    end
  end

  defp setup_new_schema do
    case Mnesia.create_schema([node()]) do
      :ok ->
        IO.puts("[Mnesia] Schema created on #{node()}")

      {:error, {_, {:already_exists, _}}} ->
        IO.puts("[Mnesia] Schema already exists on #{node()}")

      {:error, reason} ->
        IO.puts("[Mnesia] Schema creation warning: #{inspect(reason)}")
    end

    case Mnesia.change_table_copy_type(:schema, node(), :disc_copies) do
      {:atomic, :ok} -> :ok
      {:aborted, _} -> :ok
    end

    create_rooms_table([node()])
  end

  defp copy_tables_from_cluster do
    tables = Mnesia.system_info(:tables)

    for table <- tables do
      case Mnesia.add_table_copy(table, node(), :disc_copies) do
        {:atomic, :ok} ->
          IO.puts("[Mnesia] Copied table #{table} to #{node()}")

        {:aborted, {:already_exists, _, _}} ->
          IO.puts("[Mnesia] Table #{table} already exists on #{node()}")

        {:aborted, {:no_exists, _}} ->
          :ok

        {:aborted, reason} ->
          IO.puts("[Mnesia] Failed to copy table #{table}: #{inspect(reason)}")
      end
    end

    if not Enum.member?(tables, Chatroom.Room) do
      create_rooms_table(Mnesia.system_info(:running_db_nodes))
    end
  end

  defp ensure_local_tables do
    running_nodes = Mnesia.system_info(:running_db_nodes)

    if not Enum.member?(running_nodes, node()) do
      IO.puts("[Mnesia] Local node not in running nodes, re-initializing")
      setup_new_schema()
    else
      case Mnesia.table_info(Chatroom.Room, :disc_copies) do
        disc_copies when is_list(disc_copies) ->
          if not Enum.member?(disc_copies, node()) do
            IO.puts("[Mnesia] Adding #{node()} to table disc_copies")
            Mnesia.add_table_copy(Chatroom.Room, node(), :disc_copies)
          end

        _ ->
          create_rooms_table(running_nodes)
      end
    end
  end

  defp create_rooms_table(nodes) do
    attributes = [
      :id,
      :name,
      :creator_id,
      :created_at,
      :updated_at
    ]

    case Mnesia.create_table(Chatroom.Room,
      attributes: attributes,
      disc_copies: nodes,
      type: :set
    ) do
      {:atomic, :ok} ->
        IO.puts("[Mnesia] Rooms table created on #{inspect(nodes)}")

      {:aborted, {:already_exists, _}} ->
        IO.puts("[Mnesia] Rooms table already exists")

      {:aborted, reason} ->
        IO.puts("[Mnesia] Rooms table creation: #{inspect(reason)}")
    end
  end
end
