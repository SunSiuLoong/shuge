declare module '*foliate-js/epub.js' {
  export class EPUB {
    constructor(loader: unknown)
    init(): Promise<any>
  }
}

declare module '*foliate-js/view.js' {
  export const makeBook: (file: File | string) => Promise<any>
  export class View extends HTMLElement {
    [key: string]: any
  }
}

declare module '*foliate-js/vendor/zip.js' {
  export const configure: (opts: Record<string, unknown>) => void
  export const ZipReader: any
  export const BlobReader: any
  export const TextWriter: any
  export const BlobWriter: any
}

declare module '*foliate-js/search.js' {
  export const searchMatcher: (...args: any[]) => any
}

declare module '*foliate-js/epubcfi.js' {
  export const isCFI: RegExp
  export const parse: (cfi: string) => any
  export const toRange: (doc: Document, parts: any) => Range
  export const fromRange: (range: Range) => any
  export const joinIndir: (base: string, parts: any) => string
  export const fake: any
}
