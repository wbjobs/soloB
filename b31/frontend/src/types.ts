export interface WaveParameters {
  wind_speed: number
  fetch: number
  peak_frequency: number | null
  main_direction: number
}

export interface WaveDataMessage {
  type: 'wave_data'
  time: number
  grid_size: number
  min_height: number
  max_height: number
  data: number[]
}

export interface ParamsUpdatedMessage {
  type: 'params_updated'
  params: WaveParameters
}

export type WebSocketMessage = WaveDataMessage | ParamsUpdatedMessage | { type: 'pong' }
