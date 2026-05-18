import {build as viteBuild} from 'vite'
import {fileURLToPath} from 'url'
import {dirname, resolve} from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here)

await viteBuild({
    root,
    logLevel: 'info'
})

console.log(`web-ui → ${resolve(root, 'dist')}`)
