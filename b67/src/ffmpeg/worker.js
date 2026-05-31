import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const ffmpeg = new FFmpeg()

let isLoaded = false
let currentProgress = 0
let logMessages = []

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

export const loadFFmpeg = async (onProgress) => {
  if (isLoaded) return true

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'

  ffmpeg.on('progress', ({ progress }) => {
    currentProgress = Math.round(progress * 100)
    if (onProgress) onProgress(currentProgress)
  })

  ffmpeg.on('log', ({ message }) => {
    logMessages.push(message)
  })

  try {
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
    })
    isLoaded = true
    return true
  } catch (error) {
    console.error('FFmpeg 加载失败:', error)
    return false
  }
}

export const isFFmpegLoaded = () => isLoaded

export const getProgress = () => currentProgress

export const getLogs = () => logMessages

export const clearLogs = () => {
  logMessages = []
}

export const writeFile = async (fileName, data) => {
  await ffmpeg.writeFile(fileName, await fetchFile(data))
}

export const readFile = async (fileName) => {
  return await ffmpeg.readFile(fileName)
}

export const deleteFile = async (fileName) => {
  try {
    await ffmpeg.deleteFile(fileName)
  } catch (e) {
    console.warn(`删除文件 ${fileName} 失败:`, e)
  }
}

export const buildTrimCommand = (inputFile, outputFile, startTime, endTime) => {
  const duration = endTime - startTime
  return [
    '-i', inputFile,
    '-ss', formatTime(startTime),
    '-t', formatTime(duration),
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-avoid_negative_ts', '1',
    outputFile
  ]
}

const buildNormalizeCommand = (inputFile, outputFile, options = {}) => {
  const {
    fps = 30,
    audioSampleRate = 48000,
    audioChannels = 2,
    audioCodec = 'aac',
    videoCodec = 'libx264',
    preset = 'fast',
    crf = 23
  } = options

  return [
    '-i', inputFile,
    '-vf', `fps=fps=${fps},format=yuv420p`,
    '-c:v', videoCodec,
    '-preset', preset,
    '-crf', String(crf),
    '-c:a', audioCodec,
    '-ar', String(audioSampleRate),
    '-ac', String(audioChannels),
    '-b:a', '192k',
    outputFile
  ]
}

export const buildConcatCommand = (inputFiles, outputFile) => {
  const args = []
  const normalizedFiles = []
  const videoStreams = []
  const audioStreams = []

  inputFiles.forEach((file, index) => {
    args.push('-i', file)
    videoStreams.push(`[${index}:v]fps=fps=30,format=yuv420p[v${index}]`)
    audioStreams.push(`[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`)
    normalizedFiles.push(`[v${index}][a${index}]`)
  })

  const filterParts = [
    ...videoStreams,
    ...audioStreams,
    `${normalizedFiles.join('')}concat=n=${inputFiles.length}:v=1:a=1[v][a]`
  ]

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map', '[v]',
    '-map', '[a]',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-ar', '48000',
    '-ac', '2',
    '-b:a', '192k',
    outputFile
  )

  return args
}

export const buildConcatWithNormalize = async (inputFiles, outputFile, onProgress) => {
  const tempFiles = []
  const normalizedFiles = []

  try {
    for (let i = 0; i < inputFiles.length; i++) {
      const tempOutput = `normalized_${i}.mp4`
      tempFiles.push(tempOutput)
      
      const normalizeArgs = buildNormalizeCommand(inputFiles[i], tempOutput, {
        fps: 30,
        audioSampleRate: 48000,
        audioChannels: 2
      })
      
      const success = await executeCommand(normalizeArgs, onProgress)
      if (!success) {
        throw new Error(`视频 ${i + 1} 标准化失败`)
      }
      
      normalizedFiles.push(tempOutput)
    }

    const concatArgs = buildConcatCommand(normalizedFiles, outputFile)
    const success = await executeCommand(concatArgs, onProgress)
    if (!success) {
      throw new Error('视频拼接失败')
    }

    return true
  } finally {
    for (const file of tempFiles) {
      await deleteFile(file)
    }
  }
}

export const buildConcatWithTransition = (inputFiles, outputFile, options = {}) => {
  const {
    transitionDuration = 1.0,
    transitionType = 'fade'
  } = options

  if (inputFiles.length < 2) {
    return buildConcatCommand(inputFiles, outputFile)
  }

  const args = []
  const filterParts = []

  inputFiles.forEach((file, index) => {
    args.push('-i', file)
    filterParts.push(`[${index}:v]fps=fps=30,format=yuv420p,setpts=PTS-STARTPTS[v${index}]`)
    filterParts.push(`[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${index}]`)
  })

  let currentVideo = '[v0]'
  let currentAudio = '[a0]'

  for (let i = 1; i < inputFiles.length; i++) {
    const videoOutLabel = `[v_out_${i}]`
    const audioOutLabel = `[a_out_${i}]`

    filterParts.push(
      `${currentVideo}[v${i}]xfade=transition=${transitionType}:duration=${transitionDuration}:offset=99999${videoOutLabel}`
    )

    filterParts.push(
      `${currentAudio}[a${i}]acrossfade=d=${transitionDuration}:c1=tri:c2=tri${audioOutLabel}`
    )

    currentVideo = videoOutLabel
    currentAudio = audioOutLabel
  }

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map', currentVideo,
    '-map', currentAudio,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-ar', '48000',
    '-ac', '2',
    '-b:a', '192k',
    outputFile
  )

  return args
}

export const buildConcatWithDynamicTransition = async (
  inputFiles,
  outputFile,
  videoDurations,
  options = {}
) => {
  const {
    transitionDuration = 1.0,
    transitionType = 'fade'
  } = options

  if (inputFiles.length < 2) {
    const args = buildConcatCommand(inputFiles, outputFile)
    return executeCommand(args, options.onProgress)
  }

  const args = []
  const filterParts = []

  inputFiles.forEach((file, index) => {
    args.push('-i', file)
    filterParts.push(`[${index}:v]fps=fps=30,format=yuv420p,setpts=PTS-STARTPTS[v${index}]`)
    filterParts.push(`[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${index}]`)
  })

  let currentVideo = '[v0]'
  let currentAudio = '[a0]'
  let cumulativeOffset = videoDurations[0] - transitionDuration

  for (let i = 1; i < inputFiles.length; i++) {
    const videoOutLabel = `[v_out_${i}]`
    const audioOutLabel = `[a_out_${i}]`

    filterParts.push(
      `${currentVideo}[v${i}]xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${cumulativeOffset}${videoOutLabel}`
    )

    filterParts.push(
      `${currentAudio}[a${i}]acrossfade=d=${transitionDuration}:c1=tri:c2=tri${audioOutLabel}`
    )

    currentVideo = videoOutLabel
    currentAudio = audioOutLabel

    if (i < inputFiles.length - 1) {
      cumulativeOffset += videoDurations[i] - transitionDuration
    }
  }

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map', currentVideo,
    '-map', currentAudio,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-ar', '48000',
    '-ac', '2',
    '-b:a', '192k',
    outputFile
  )

  return executeCommand(args, options.onProgress)
}

export const buildWatermarkCommand = (videoFile, watermarkFile, outputFile, position = 'top-left') => {
  let overlayFilter
  switch (position) {
    case 'top-left':
      overlayFilter = '10:10'
      break
    case 'top-right':
      overlayFilter = 'W-w-10:10'
      break
    case 'bottom-left':
      overlayFilter = '10:H-h-10'
      break
    case 'bottom-right':
      overlayFilter = 'W-w-10:H-h-10'
      break
    default:
      overlayFilter = '10:10'
  }
  
  return [
    '-i', videoFile,
    '-i', watermarkFile,
    '-filter_complex',
    `[0:v][1:v]overlay=${overlayFilter}[outv]`,
    '-map', '[outv]',
    '-map', '0:a',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    outputFile
  ]
}

export const executeCommand = async (args, onProgress) => {
  currentProgress = 0
  clearLogs()
  
  const progressHandler = ({ progress }) => {
    const pct = Math.round(progress * 100)
    currentProgress = pct
    if (onProgress) onProgress(pct)
  }
  
  ffmpeg.on('progress', progressHandler)
  
  try {
    await ffmpeg.exec(args)
    return true
  } catch (error) {
    console.error('FFmpeg 执行失败:', error)
    console.error('日志:', logMessages.slice(-20).join('\n'))
    return false
  } finally {
    ffmpeg.off('progress', progressHandler)
  }
}

export const getVideoDuration = async (inputFile) => {
  const probeCmd = ['-i', inputFile, '-f', 'null', '-']
  
  try {
    await ffmpeg.exec(probeCmd)
  } catch (e) {
  }
  
  const logs = getLogs()
  const durationMatch = logs
    .join('\n')
    .match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/)
  
  if (durationMatch) {
    const hours = parseInt(durationMatch[1])
    const minutes = parseInt(durationMatch[2])
    const seconds = parseInt(durationMatch[3])
    const ms = parseInt(durationMatch[4]) / 100
    return hours * 3600 + minutes * 60 + seconds + ms
  }
  
  return 0
}
