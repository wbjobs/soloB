defmodule ChatroomWeb.Router do
  use ChatroomWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", ChatroomWeb do
    pipe_through :api

    get "/health", HealthController, :index
  end
end
