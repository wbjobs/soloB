# Minecraft Redstone Simulator

A 3D Minecraft redstone circuit simulator built with Electron, Three.js, and Python.

## Features

- 3D grid-based rendering with Three.js
- Real-time redstone signal propagation simulation
- Support for various redstone components:
  - Redstone wire (0-15 signal strength)
  - Redstone torch (inverter)
  - Redstone repeater (with delay and locking)
  - Redstone comparator
  - Lever (power source)
  - Piston
  - Redstone lamp
  - Solid blocks
- Tick-based simulation (play/pause/step)
- Adjustable simulation speed
- JSON import/export for circuit layouts
- Python backend for signal computation

## Prerequisites

- Node.js (v16+)
- Python (v3.8+)
- pip

## Installation

1. Install Node.js dependencies:
```bash
npm install
```

2. Install Python dependencies:
```bash
cd backend
pip install -r requirements.txt
cd ..
```

## Running the Application

```bash
npm start
```

This will:
1. Start the Python WebSocket backend server
2. Launch the Electron frontend application

## Controls

| Action | Control |
|--------|---------|
| Place block | Left-click on grid |
| Delete block | Select Eraser, then left-click |
| Rotate component | Right-click on repeater/comparator/piston |
| Toggle lever | Right-click on lever |
| Rotate camera | Click and drag with mouse |
| Zoom in/out | Scroll wheel |
| Play/Pause simulation | Spacebar or Play button |
| Step one tick | Step button |
| Export layout | Export button |
| Import layout | Import button |
| Change repeater delay | **Shift + Right-click** on repeater |
| Toggle comparator mode | **Shift + Right-click** on comparator |
| Monitor node signal | **Ctrl + Right-click** on any block |

## Frequency Analyzer

The built-in frequency analyzer helps you debug redstone circuits by visualizing signal patterns:

### Features:
- **Real-time Waveform Display**: Shows signal strength history over the last 200 ticks
- **Frequency Calculation**: Measures pulse rate in Hz (oscillations per second)
- **Duty Cycle**: Percentage of time the signal is HIGH
- **High Frequency Detection**: Automatically highlights nodes oscillating faster than 0.25 Hz
  - Oscillating blocks pulse with orange glow in the 3D view
- **Auto Monitor Mode**: Automatically tracks the highest frequency node
- **Manual Monitoring**: Ctrl+Right-click any block to monitor it specifically

### Display:
- Green rotating ring marker shows currently monitored position
- Red waveform graph visualizes signal amplitude over time
- Real-time statistics update every simulation tick

## Component Notes

### Repeater
- **4 delay levels** (1-4 ticks) - change with Shift + Right-click
- Can be locked by another repeater pointing into its side
- When locked, maintains current output regardless of input

### Comparator
- **2 modes**:
  - **Compare mode** (default): Output = input if input >= side input
  - **Subtract mode**: Output = max(0, input - side input)
- Toggle modes with Shift + Right-click
- Front torch indicates mode: lit = subtract mode

## Component Selection

Use the sidebar to select the component you want to place:

- 🗑️ Eraser: Remove blocks
- 🧱 Block: Solid conductive block
- 🔴 Redstone: Redstone wire
- ⏩ Repeater: Delays and amplifies signal
- ⚖️ Comparator: Compares signals (subtraction mode)
- 🔥 Torch: Inverts signal (place on top of block)
- 🔘 Lever: Manual power source
- ⬆️ Piston: Push blocks (basic implementation)
- 💡 Lamp: Lights up when powered

## Redstone Rules Implemented

1. **Redstone wire**: Signal decreases by 1 per block traveled, max 15
2. **Redstone torch**: Inverts signal from block below, outputs 15 if not powered
3. **Repeater**: 
   - Delays signal by 1-4 ticks (configurable)
   - Amplifies signal back to 15
   - Can be locked by side-input repeaters
4. **Comparator**: Outputs max(0, input - side_input)
5. **Solid blocks**: Can be powered and conduct signal to adjacent components
6. **Lever**: Provides constant 15 signal when toggled on
7. **Lamp**: Lights up when receiving any signal

## File Structure

```
redstone-simulator/
├── main.js              # Electron main process
├── renderer.js          # Three.js frontend and UI logic
├── index.html           # HTML entry point
├── package.json         # Node.js dependencies
├── README.md            # This file
└── backend/
    ├── server.py        # Python WebSocket + Redstone logic
    └── requirements.txt # Python dependencies
```

## Troubleshooting

- If the backend fails to start, ensure Python is in your PATH and websockets is installed
- If WebSocket connection fails, check if port 8765 is available
- Python console output is visible in the terminal where you ran `npm start`
- Press F12 in the Electron window to open dev tools for debugging
