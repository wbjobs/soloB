defmodule ChatroomWeb do
  def controller do
    quote do
      use Phoenix.Controller, namespace: ChatroomWeb

      import Plug.Conn
      alias ChatroomWeb.Router.Helpers, as: Routes
    end
  end

  def channel do
    quote do
      use Phoenix.Channel

      alias Chatroom.Presence
    end
  end

  def router do
    quote do
      use Phoenix.Router

      import Plug.Conn
      import Phoenix.Controller
    end
  end

  defmacro __using__(which) when is_atom(which) do
    apply(__MODULE__, which, [])
  end
end
