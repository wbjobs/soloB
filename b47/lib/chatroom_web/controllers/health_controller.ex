defmodule ChatroomWeb.HealthController do
  use ChatroomWeb, :controller

  def index(conn, _params) do
    json(conn, %{status: "ok", node: Node.self()})
  end
end
