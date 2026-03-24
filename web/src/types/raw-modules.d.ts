declare module '*.md?raw' {
  const content: string
  export default content
}

declare module 'marked' {
  export const marked: {
    setOptions: (options: Record<string, unknown>) => void
    parse: (markdown: string) => string | Promise<string>
  }
}
