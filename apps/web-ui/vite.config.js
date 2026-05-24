import {defineConfig} from 'vite'
import {svelte} from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import {execSync} from 'node:child_process'
import {createRequire} from 'node:module'

// Versione mostrata in UI. Priorità: VITE_APP_VERSION (iniettata in build Docker/CI
// dal tag git, dove il .git non è nel context) → `git describe` (sviluppo locale) →
// version di package.json (fallback).
function appVersion() {
    if (process.env.VITE_APP_VERSION) return process.env.VITE_APP_VERSION
    try {
        return execSync('git describe --tags --always --dirty', {stdio: ['ignore', 'pipe', 'ignore']})
            .toString().trim()
    } catch {
        return createRequire(import.meta.url)('./package.json').version
    }
}

export default defineConfig({
    plugins: [svelte(), tailwindcss()],
    define: {
        __APP_VERSION__: JSON.stringify(appVersion())
    },
    server: {
        proxy: {
            '/api': {
                target: process.env.VITE_API_URL ?? 'http://localhost:3000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, '')
            }
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true
    }
})
