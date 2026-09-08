import { build } from 'esbuild'
import { writeFile, mkdir } from 'node:fs/promises'
const root = new URL('../packages/web/', import.meta.url).pathname
await mkdir(root + 'lib', { recursive: true })
await build({ entryPoints: [root + 'src/index.ts'], outfile: root + 'lib/index.js', format: 'esm', platform: 'node' })
const result = await build({
  entryPoints: [root + 'src/client/index.tsx'], bundle: true, write: false,
  platform: 'browser', format: 'cjs', jsx: 'automatic', target: 'es2022',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store'],
  loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
})
await writeFile(root + 'lib/client.js', `window.__ModuleLoader__.load({id:"@oryh/dsh-client",factory:(require)=>{const module={exports:{}};const exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;}});\n`)
