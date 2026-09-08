import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { resolveRuntime } from './runtime/host.mjs'
import { launchElectron } from './runtime/electron.mjs'
import { sleep } from './runtime/process.mjs'
import { captureChromium } from './capture/chromium.mjs'
import { authorProject, renderProject } from './projects.mjs'
import { runActions } from './actions/runner.mjs'
import {
  WEB_SCRIPT,
  ELECTRON_SCRIPT,
  ELECTRON_ANCHORS,
} from './examples/recipes.mjs'
export { ELECTRON_SCRIPT, ELECTRON_ANCHORS } from './examples/recipes.mjs'

const DEMO_URL = new URL('../demo/index.html', import.meta.url).href
const ELECTRON_APP = fileURLToPath(
  new URL('../demo/electron-app', import.meta.url),
)
function workDir(path) {
  path ??= mkdtempSync(join(tmpdir(), 'cine-session-'))
  mkdirSync(path, { recursive: true })
  return path
}

export async function runWebDemo({
  outPath = join(homedir(), 'Downloads', 'cine-demo.mp4'),
  workDir: directory,
  fps = 30,
  url = DEMO_URL,
  connectTo,
  targetUrl,
  beats = WEB_SCRIPT,
  runtime,
  displayPoints,
  leadInMs,
  tailMs,
  inspectionDir,
} = {}) {
  runtime ??= await resolveRuntime()
  const work = workDir(directory)
  const capture = await captureChromium({
    url,
    connectTo,
    targetUrl,
    beats,
    runtime,
    fps,
    displayPoints,
    leadInMs,
    tailMs,
    videoPath: join(work, 'raw.mp4'),
    cursorPath: join(work, 'cursor.jsonl'),
  })
  const projectPath = join(work, 'project.json')
  authorProject(capture.manifestPath, projectPath)
  return renderProject(projectPath, { outPath, runtime, inspectionDir })
}

export async function captureElectron({
  workDir: directory,
  fps = 30,
  runtime,
  beats = ELECTRON_SCRIPT,
  leadInMs,
  tailMs,
} = {}) {
  runtime ??= await resolveRuntime()
  const work = workDir(directory),
    host = await launchElectron(ELECTRON_APP)
  try {
    await sleep(600)
    return await captureChromium({
      connectTo: host.endpoint,
      beats,
      anchorSelectors: ELECTRON_ANCHORS,
      fps,
      runtime,
      leadInMs,
      tailMs,
      videoPath: join(work, 'raw.mp4'),
      cursorPath: join(work, 'cursor.jsonl'),
    })
  } finally {
    await host.stop()
  }
}

export async function runElectronDemo({
  outPath = join(homedir(), 'Downloads', 'cine-electron-demo.mp4'),
  workDir: directory,
  connectTo,
  targetUrl,
  runtime,
  fps = 30,
  beats = ELECTRON_SCRIPT,
  leadInMs,
  tailMs,
  inspectionDir,
} = {}) {
  runtime ??= await resolveRuntime()
  if (connectTo)
    return runWebDemo({
      outPath,
      workDir: directory,
      connectTo,
      targetUrl,
      beats,
      runtime,
      fps,
      leadInMs,
      tailMs,
      inspectionDir,
    })
  const work = workDir(directory)
  const capture = await captureElectron({
    workDir: work,
    runtime,
    fps,
    beats,
    leadInMs,
    tailMs,
  })
  const projectPath = join(work, 'project.json')
  authorProject(capture.manifestPath, projectPath)
  return renderProject(projectPath, { outPath, runtime, inspectionDir })
}

export async function runDemo({
  outPath = join(homedir(), 'Downloads', 'cine-native-demo.mp4'),
  workDir: directory,
  runtime,
  fps = 30,
  url = DEMO_URL,
  beats = WEB_SCRIPT,
  leadInMs = 1400,
  tailMs = 1600,
  inspectionDir,
} = {}) {
  runtime ??= await resolveRuntime()
  const { startCapture, mainDisplay } =
    await import('./platform/macos/capture.mjs')
  const { macosDriver } = await import('./platform/macos/input.mjs')
  const geometry = mainDisplay(),
    work = workDir(directory)
  let browser, recording
  try {
    browser = await puppeteer.launch({
      executablePath: runtime.chrome,
      headless: false,
      defaultViewport: null,
      args: ['--kiosk', '--no-default-browser-check', '--disable-infobars'],
    })
    const page = (await browser.pages())[0]
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.bringToFront()
    const client = await page.createCDPSession()
    recording = await startCapture({
      videoPath: join(work, 'raw.mp4'),
      cursorPath: join(work, 'cursor.jsonl'),
      runtime,
      fps,
      geometry,
    })
    await runActions(beats, macosDriver(page, client), {
      start: {
        x: geometry.x + geometry.w / 2,
        y: geometry.y + geometry.h * 0.72,
      },
      onAction: recording.onAction,
      onEvent: recording.onEvent,
      leadInMs,
      tailMs,
    })
    const capture = await recording.stop()
    recording = null
    await browser.close()
    browser = null
    const projectPath = join(work, 'project.json')
    authorProject(capture.manifestPath, projectPath)
    return await renderProject(projectPath, { outPath, runtime, inspectionDir })
  } finally {
    try {
      if (recording) await recording.abort()
    } finally {
      if (browser) await browser.close()
    }
  }
}
