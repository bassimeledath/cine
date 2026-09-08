import { build } from 'esbuild'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from 'node:fs'
import { resolve, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CineError } from '../core/errors.mjs'
const HERE = dirname(fileURLToPath(import.meta.url))
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
}
export const TEMPLATES = {
  title: 'title.mjs',
  chapter: 'chapter.mjs',
  metric: 'metric.tsx',
  split: 'split.tsx',
}
export function scaffoldScene(template, directory) {
  if (!TEMPLATES[template])
    throw new CineError(
      'UNKNOWN_TEMPLATE',
      'template',
      `Choose ${Object.keys(TEMPLATES).join(', ')}`,
    )
  const file = join(resolve(directory), TEMPLATES[template]),
    sdk = join(resolve(directory), 'sdk.mjs')
  if (existsSync(file) || existsSync(sdk))
    throw new Error(
      'Scene destination already contains source; choose a new directory',
    )
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    file,
    readFileSync(join(HERE, 'templates', TEMPLATES[template]), 'utf8').replace(
      "'../sdk.mjs'",
      "'./sdk.mjs'",
    ),
  )
  copyFileSync(join(HERE, 'sdk.mjs'), sdk)
  copyFileSync(join(HERE, 'types.d.ts'), join(resolve(directory), 'types.d.ts'))
  return { entry: file, adapter: extname(file) === '.tsx' ? 'react' : 'module' }
}
export function sceneAssets(input = {}, baseDir) {
  return Object.fromEntries(
    Object.entries(input).map(([id, file]) => {
      if (typeof file !== 'string')
        throw new Error(`Scene asset ${id} must be a file path`)
      const path = resolve(baseDir, file),
        mime = MIME[extname(path).toLowerCase()]
      if (!mime) throw new Error(`Unsupported scene asset: ${file}`)
      const data = readFileSync(path)
      if (data.length > 32 * 1024 * 1024)
        throw new Error(`Scene asset exceeds 32 MiB: ${file}`)
      return [id, `data:${mime};base64,${data.toString('base64')}`]
    }),
  )
}
export async function buildScene(spec, baseDir) {
  const path = `scenes.${spec.id ?? 'cover'}`
  try {
    const entry = resolve(baseDir, spec.entry),
      react = spec.adapter === 'react' || /\.[jt]sx$/.test(entry)
    const assets = sceneAssets(spec.assets, baseDir)
    if (extname(entry) === '.html')
      return {
        ...spec,
        html: readFileSync(entry, 'utf8').replace(
          /\{\{asset:([\w.-]+)\}\}/g,
          (_, id) => {
            if (!assets[id]) throw new Error(`Unknown scene asset ${id}`)
            return assets[id]
          },
        ),
        assets,
      }
    const wrapper = react
      ? `import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import Component from ${JSON.stringify(entry)};export function createScene(root,context){let failure;const reactRoot=createRoot(root,{onUncaughtError:error=>{failure=error}});return{renderFrame(frame){failure=undefined;flushSync(()=>reactRoot.render(React.createElement(Component,{...context,...frame})));if(failure)throw failure},dispose(){reactRoot.unmount()}}}`
      : `export {createScene} from ${JSON.stringify(entry)}`
    const result = await build({
      stdin: { contents: wrapper, resolveDir: dirname(entry), loader: 'js' },
      nodePaths: [resolve(HERE, '../../node_modules')],
      bundle: true,
      write: false,
      outfile: 'scene.js',
      format: 'iife',
      globalName: 'CineSceneModule',
      platform: 'browser',
      jsx: 'automatic',
      target: 'chrome120',
      sourcemap: 'inline',
      logLevel: 'silent',
      loader: {
        '.png': 'dataurl',
        '.jpg': 'dataurl',
        '.svg': 'dataurl',
        '.woff2': 'dataurl',
      },
      define: { 'process.env.NODE_ENV': '"production"' },
    })
    return {
      ...spec,
      code: result.outputFiles.find((f) => f.path.endsWith('.js')).text,
      css: result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '',
      assets,
    }
  } catch (error) {
    throw new CineError(
      'SCENE_BUILD',
      path,
      error.message,
      'Fix the local scene entry/imports; render never installs packages',
    )
  }
}
