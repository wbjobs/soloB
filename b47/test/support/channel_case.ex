defmodule ChatroomWeb.ChannelCase do
  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest
      import ChatroomWeb.ChannelCase

      @endpoint ChatroomWeb.Endpoint
    end
  end

  setup _tags do
    :ok
  end
end
