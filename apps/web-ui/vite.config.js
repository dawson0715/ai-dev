import {defineConfig} from 'vite'
import {svelte} from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [svelte(), tailwindcss()],
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
