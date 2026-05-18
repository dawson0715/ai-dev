let nextId = 1

class ToastStore {
    items = $state([])

    push(message, type = 'info', timeout = 3500) {
        const id = nextId++
        this.items.push({id, message, type})
        if (timeout > 0) {
            setTimeout(() => this.dismiss(id), timeout)
        }
        return id
    }

    success(msg) { return this.push(msg, 'success') }
    error(msg) { return this.push(msg, 'error', 6000) }
    info(msg) { return this.push(msg, 'info') }

    dismiss(id) {
        const idx = this.items.findIndex(t => t.id === id)
        if (idx >= 0) this.items.splice(idx, 1)
    }
}

export const toast = new ToastStore()
