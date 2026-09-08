import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = process.cwd()
for (const artifact of new WorkspaceTypertGenerator(root).generate(['@oryh/dsh-host'], ['host'])) {
  const output = resolve(root, artifact.packageRoot, 'lib')
  await writeFile(resolve(output, `typert.${artifact.face}.js`), artifact.js)
  await writeFile(resolve(output, `typert.${artifact.face}.d.ts`), artifact.dts)
  if (artifact.remote) {
    await writeFile(resolve(output, 'typert.remote-client.js'), artifact.remote.js)
    await writeFile(resolve(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
    await writeFile(resolve(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
  }
}
