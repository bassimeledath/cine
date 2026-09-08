export class CineError extends Error {
  constructor(code, path, message, suggestion) {
    super(`${path}: ${message}`)
    this.name = 'CineError'
    this.code = code
    this.path = path
    this.suggestion = suggestion
  }
  toJSON() {
    return {
      code: this.code,
      path: this.path,
      message: this.message,
      suggestion: this.suggestion,
    }
  }
}
export function requireValue(condition, code, path, message, suggestion) {
  if (!condition) throw new CineError(code, path, message, suggestion)
}
export function uniqueIds(items, path) {
  const ids = new Set()
  for (const [i, item] of items.entries()) {
    requireValue(
      typeof item.id === 'string' &&
        /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(item.id),
      'INVALID_ID',
      `${path}[${i}].id`,
      'Expected a stable nonempty ID',
    )
    requireValue(
      !ids.has(item.id),
      'DUPLICATE_ID',
      `${path}[${i}].id`,
      `Duplicate ID ${item.id}`,
    )
    ids.add(item.id)
  }
}
