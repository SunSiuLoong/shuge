import * as CFI from './epubcfi.js'

const NS = {
    CONTAINER: 'urn:oasis:names:tc:opendocument:xmlns:container',
    XHTML: 'http://www.w3.org/1999/xhtml',
    OPF: 'http://www.idpf.org/2007/opf',
    EPUB: 'http://www.idpf.org/2007/ops',
    DC: 'http://purl.org/dc/elements/1.1/',
    DCTERMS: 'http://purl.org/dc/terms/',
    ENC: 'http://www.w3.org/2001/04/xmlenc#',
    NCX: 'http://www.daisy.org/z3986/2005/ncx/',
    XLINK: 'http://www.w3.org/1999/xlink',
    SMIL: 'http://www.w3.org/ns/SMIL',
}

const MIME = {
    XML: 'application/xml',
    NCX: 'application/x-dtbncx+xml',
    XHTML: 'application/xhtml+xml',
    HTML: 'text/html',
    CSS: 'text/css',
    SVG: 'image/svg+xml',
    JS: /\/(x-)?(javascript|ecmascript)/,
}

// https://www.w3.org/TR/epub-33/#sec-reserved-prefixes
const PREFIX = {
    a11y: 'http://www.idpf.org/epub/vocab/package/a11y/#',
    dcterms: 'http://purl.org/dc/terms/',
    marc: 'http://id.loc.gov/vocabulary/',
    media: 'http://www.idpf.org/epub/vocab/overlays/#',
    onix: 'http://www.editeur.org/ONIX/book/codelists/current.html#',
    rendition: 'http://www.idpf.org/vocab/rendition/#',
    schema: 'http://schema.org/',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    msv: 'http://www.idpf.org/epub/vocab/structure/magazine/#',
    prism: 'http://www.prismstandard.org/specifications/3.0/PRISM_CV_Spec_3.0.htm#',
}

const RELATORS = {
    art: 'artist',
    aut: 'author',
    clr: 'colorist',
    edt: 'editor',
    ill: 'illustrator',
    nrt: 'narrator',
    trl: 'translator',
    pbl: 'publisher',
}

const ONIX5 = {
    '02': 'isbn',
    '06': 'doi',
    '15': 'isbn',
    '26': 'doi',
    '34': 'issn',
}

// convert to camel case
const camel = x => x.toLowerCase().replace(/[-:](.)/g, (_, g) => g.toUpperCase())

// strip and collapse ASCII whitespace
// https://infra.spec.whatwg.org/#strip-and-collapse-ascii-whitespace
const normalizeWhitespace = str => str ? str
    .replace(/[\t\n\f\r ]+/g, ' ')
    .replace(/^[\t\n\f\r ]+/, '')
    .replace(/[\t\n\f\r ]+$/, '') : ''

const filterAttribute = (attr, value, isList) => isList
    ? el => el.getAttribute(attr)?.split(/\s/)?.includes(value)
    : typeof value === 'function'
        ? el => value(el.getAttribute(attr))
        : el => el.getAttribute(attr) === value

const getAttributes = (...xs) => el =>
    el ? Object.fromEntries(xs.map(x => [camel(x), el.getAttribute(x)])) : null

const getElementText = el => normalizeWhitespace(el?.textContent)

const childGetter = (doc, ns) => {
    // ignore the namespace if it doesn't appear in document at all
    const useNS = doc.lookupNamespaceURI(null) === ns || doc.lookupPrefix(ns)
    const f = useNS
        ? (el, name) => el => el.namespaceURI === ns && el.localName === name
        : (el, name) => el => el.localName === name
    // [shuge] EPUB2 包常常只在根元素声明 xmlns:opf 而没有默认命名空间，
    // 此时 <metadata>/<manifest> 等子元素的 namespaceURI 是 null，纯 ns 过滤会全部落空
    // （典型崩溃：Cannot read properties of undefined (reading 'children')）。
    // 兜底：ns 过滤不到时退化为 localName 匹配。
    const fallback = (el, name) => el => el.localName === name
    return {
        $: (el, name) => [...el.children].find(f(el, name))
            ?? (useNS ? [...el.children].find(fallback(el, name)) : undefined),
        $$: (el, name) => {
            const hit = [...el.children].filter(f(el, name))
            return hit.length || !useNS ? hit : [...el.children].filter(fallback(el, name))
        },
        $$$: useNS
            ? (el, name) => [...el.getElementsByTagNameNS(ns, name)]
            : (el, name) => [...el.getElementsByTagName(name)],
    }
}

// [shuge] 原来用 relativeTo.includes(':') 判断 base 是不是绝对 URL，太粗：
// 多看系混淆过的文件名（`_*::::***::*.xhtml`）里全是冒号，会被误判成绝对 URL，
// 走 new URL(url, relativeTo) 直接抛 "Invalid base URL"，封面/插图就静默失效。
const ABS_URL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i
const SCHEME_URL = /^(?:blob|data|about|file|filesystem):/i
const resolveURL = (url, relativeTo) => {
    try {
        if (ABS_URL.test(relativeTo) || SCHEME_URL.test(relativeTo))
            return new URL(url, relativeTo)
        // the base needs to be a valid URL, so set a base URL and then remove it
        const root = 'https://invalid.invalid/'
        const obj = new URL(url, root + relativeTo)
        obj.search = ''
        return decodeURI(obj.href.replace(root, ''))
    } catch(e) {
        console.warn(e)
        return url
    }
}

const isExternal = uri => /^(?!blob)\w+:/i.test(uri)

// [shuge] 容错解码：多看等工具会混用编码/未编码路径，比较前统一解码
const safeDecode = uri => {
    if (typeof uri !== 'string') return uri
    try {
        return decodeURIComponent(uri)
    } catch {
        return uri
    }
}

// [shuge] 归一化路径：折叠 . 与 .. 段后再比较。
// foliate 的 resolveURL 对某些形态的 base 会返回带 ../ 的未归一化路径，导致查不到 manifest 条目。
const normalizePath = uri => {
    if (typeof uri !== 'string') return uri
    const segs = uri.split('/')
    const out = []
    for (const seg of segs) {
        if (seg === '.' || seg === '') continue
        if (seg === '..') {
            if (out.length > 1) out.pop()
            continue
        }
        out.push(seg)
    }
    return out.join('/')
}

const pathKey = uri => normalizePath(safeDecode(uri))

// [shuge] 按扩展名推断媒体类型，供 manifest 未登记的资源兜底加载
const EXT_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    css: 'text/css', ttf: 'font/ttf', otf: 'font/otf',
    woff: 'font/woff', woff2: 'font/woff2',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4',
}
const guessMediaType = path => {
    const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(path ?? '')
    return m ? EXT_MIME[m[1].toLowerCase()] : undefined
}

// like `path.relative()` in Node.js
const pathRelative = (from, to) => {
    if (!from) return to
    const as = from.replace(/\/$/, '').split('/')
    const bs = to.replace(/\/$/, '').split('/')
    const i = (as.length > bs.length ? as : bs).findIndex((_, i) => as[i] !== bs[i])
    return i < 0 ? '' : Array(as.length - i).fill('..').concat(bs.slice(i)).join('/')
}

const pathDirname = str => str.slice(0, str.lastIndexOf('/') + 1)

// replace asynchronously and sequentially
// same technique as https://stackoverflow.com/a/48032528
const replaceSeries = async (str, regex, f) => {
    const matches = []
    str.replace(regex, (...args) => (matches.push(args), null))
    const results = []
    for (const args of matches) results.push(await f(...args))
    return str.replace(regex, () => results.shift())
}

const regexEscape = str => str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')

const tidy = obj => {
    for (const [key, val] of Object.entries(obj))
        if (val == null) delete obj[key]
        else if (Array.isArray(val)) {
            obj[key] = val.filter(x => x).map(x =>
                typeof x === 'object' && !Array.isArray(x) ? tidy(x) : x)
            if (!obj[key].length) delete obj[key]
            else if (obj[key].length === 1) obj[key] = obj[key][0]
        }
        else if (typeof val === 'object') {
            obj[key] = tidy(val)
            if (!Object.keys(val).length) delete obj[key]
        }
    const keys = Object.keys(obj)
    if (keys.length === 1 && keys[0] === 'name') return obj[keys[0]]
    return obj
}

// https://www.w3.org/TR/epub/#sec-prefix-attr
const getPrefixes = doc => {
    const map = new Map(Object.entries(PREFIX))
    const value = doc.documentElement.getAttributeNS(NS.EPUB, 'prefix')
        || doc.documentElement.getAttribute('prefix')
    if (value) for (const [, prefix, url] of value
        .matchAll(/(.+): +(.+)[ \t\r\n]*/g)) map.set(prefix, url)
    return map
}

// https://www.w3.org/TR/epub-rs/#sec-property-values
// but ignoring the case where the prefix is omitted
const getPropertyURL = (value, prefixes) => {
    if (!value) return null
    const [a, b] = value.split(':')
    const prefix = b ? a : null
    const reference = b ? b : a
    const baseURL = prefixes.get(prefix)
    return baseURL ? baseURL + reference : null
}

// [shuge] 国产导出工具常把 dc 命名空间写成 http://purl.org/dc/elements/1.1（少末尾斜杠），
// 严格比较会让所有 dc:* 全部落空，最终在 Object.groupBy(els.dc) 处炸掉。
const isDCNS = ns => typeof ns === 'string'
    && ns.replace(/\/+$/, '') === NS.DC.replace(/\/+$/, '')

const getMetadata = opf => {
    const { $ } = childGetter(opf, NS.OPF)
    const $metadata = $(opf.documentElement, 'metadata')

    // first pass: convert to JS objects
    const els = Object.groupBy($metadata.children, el =>
        isDCNS(el.namespaceURI) ? 'dc'
        : el.namespaceURI === NS.OPF && el.localName === 'meta' ?
            (el.hasAttribute('name') ? 'legacyMeta' : 'meta') : '')
    const baseLang = $metadata.getAttribute('xml:lang')
        ?? opf.documentElement.getAttribute('xml:lang') ?? 'und'
    const prefixes = getPrefixes(opf)
    const parse = el => {
        const property = el.getAttribute('property')
        const scheme = el.getAttribute('scheme')
        return {
            property: getPropertyURL(property, prefixes) ?? property,
            scheme: getPropertyURL(scheme, prefixes) ?? scheme,
            lang: el.getAttribute('xml:lang'),
            value: getElementText(el),
            props: getProperties(el),
            // `opf:` attributes from EPUB 2 & EPUB 3.1 (removed in EPUB 3.2)
            attrs: Object.fromEntries(Array.from(el.attributes)
                .filter(attr => attr.namespaceURI === NS.OPF)
                .map(attr => [attr.localName, attr.value])),
        }
    }
    const refines = Map.groupBy(els.meta ?? [], el => el.getAttribute('refines'))
    const getProperties = el => {
        const els = refines.get(el ? '#' + el.getAttribute('id') : null)
        if (!els) return null
        return Object.groupBy(els.map(parse), x => x.property)
    }
    const dc = Object.fromEntries(Object.entries(Object.groupBy(els.dc, el => el.localName))
        .map(([name, els]) => [name, els.map(parse)]))
    const properties = getProperties() ?? {}
    const legacyMeta = Object.fromEntries(els.legacyMeta?.map(el =>
        [el.getAttribute('name'), el.getAttribute('content')]) ?? [])

    // second pass: map to webpub
    const one = x => x?.[0]?.value
    const prop = (x, p) => one(x?.props?.[p])
    const makeLanguageMap = x => {
        if (!x) return null
        const alts = x.props?.['alternate-script'] ?? []
        const altRep = x.attrs['alt-rep']
        if (!alts.length && (!x.lang || x.lang === baseLang) && !altRep) return x.value
        const map = { [x.lang ?? baseLang]: x.value }
        if (altRep) map[x.attrs['alt-rep-lang']] = altRep
        for (const y of alts) map[y.lang] ??= y.value
        return map
    }
    const makeContributor = x => x ? ({
        name: makeLanguageMap(x),
        sortAs: makeLanguageMap(x.props?.['file-as']?.[0]) ?? x.attrs['file-as'],
        role: x.props?.role?.filter(x => x.scheme === PREFIX.marc + 'relators')
            ?.map(x => x.value) ?? [x.attrs.role],
        code: prop(x, 'term') ?? x.attrs.term,
        scheme: prop(x, 'authority') ?? x.attrs.authority,
    }) : null
    const makeCollection = x => ({
        name: makeLanguageMap(x),
        // NOTE: webpub requires number but EPUB allows values like "2.2.1"
        position: one(x.props?.['group-position']),
    })
    const makeAltIdentifier = x => {
        const { value } = x
        if (/^urn:/i.test(value)) return value
        if (/^doi:/i.test(value)) return `urn:${value}`
        const type = x.props?.['identifier-type']
        if (!type) {
            const scheme = x.attrs.scheme
            if (!scheme) return value
            // https://idpf.github.io/epub-registries/identifiers/
            // but no "jdcn", which isn't a registered URN namespace
            if (/^(doi|isbn|uuid)$/i.test(scheme)) return `urn:${scheme}:${value}`
            // NOTE: webpub requires scheme to be a URI; EPUB allows anything
            return { scheme, value }
        }
        if (type.scheme === PREFIX.onix + 'codelist5') {
            const nid = ONIX5[type.value]
            if (nid) return `urn:${nid}:${value}`
        }
        return value
    }
    const belongsTo = Object.groupBy(properties['belongs-to-collection'] ?? [],
        x => prop(x, 'collection-type') === 'series' ? 'series' : 'collection')
    const mainTitle = dc.title?.find(x => prop(x, 'title-type') === 'main') ?? dc.title?.[0]
    const metadata = {
        identifier: getIdentifier(opf),
        title: makeLanguageMap(mainTitle),
        sortAs: makeLanguageMap(mainTitle?.props?.['file-as']?.[0])
            ?? mainTitle?.attrs?.['file-as']
            ?? legacyMeta?.['calibre:title_sort'],
        subtitle: dc.title?.find(x => prop(x, 'title-type') === 'subtitle')?.value,
        language: dc.language?.map(x => x.value),
        description: one(dc.description),
        publisher: dc.publisher?.map(makeContributor),
        published: dc.date?.find(x => x.attrs.event === 'publication')?.value
            ?? one(dc.date),
        modified: one(properties[PREFIX.dcterms + 'modified'])
            ?? dc.date?.find(x => x.attrs.event === 'modification')?.value,
        subject: dc.subject?.map(makeContributor),
        belongsTo: {
            collection: belongsTo.collection?.map(makeCollection),
            series: belongsTo.series?.map(makeCollection)
            ?? legacyMeta?.['calibre:series'] ? {
                name: legacyMeta?.['calibre:series'],
                position: parseFloat(legacyMeta?.['calibre:series_index']),
            } : null,
        },
        altIdentifier: dc.identifier?.map(makeAltIdentifier),
        source: dc.source?.map(makeAltIdentifier), // NOTE: not in webpub schema
        rights: one(dc.rights), // NOTE: not in webpub schema
        pageBreakSource: one(properties['pageBreakSource']), // NOTE: not in webpub schema
    }
    const remapContributor = defaultKey => x => {
        const keys = new Set(x.role?.map(role => RELATORS[role] ?? defaultKey))
        return [keys.size ? keys : [defaultKey], x]
    }
    for (const [keys, val] of [].concat(
        dc.creator?.map(makeContributor)?.map(remapContributor('author')) ?? [],
        dc.contributor?.map(makeContributor)?.map(remapContributor('contributor')) ?? []))
        for (const key of keys)
            if (metadata[key]) metadata[key].push(val)
            else metadata[key] = [val]
    tidy(metadata)
    if (metadata.altIdentifier === metadata.identifier)
        delete metadata.altIdentifier

    const rendition = {}
    const media = {}
    for (const [key, val] of Object.entries(properties)) {
        if (key.startsWith(PREFIX.rendition))
            rendition[camel(key.replace(PREFIX.rendition, ''))] = one(val)
        else if (key.startsWith(PREFIX.media))
            media[camel(key.replace(PREFIX.media, ''))] = one(val)
    }
    if (media.duration) media.duration = parseClock(media.duration)
    return { metadata, rendition, media }
}

const parseNav = (doc, resolve = f => f) => {
    const { $, $$, $$$ } = childGetter(doc, NS.XHTML)
    const resolveHref = href => href ? decodeURI(resolve(href)) : null
    const parseLI = getType => $li => {
        const $a = $($li, 'a') ?? $($li, 'span')
        const $ol = $($li, 'ol')
        const href = resolveHref($a?.getAttribute('href'))
        const label = getElementText($a) || $a?.getAttribute('title')
        // TODO: get and concat alt/title texts in content
        const result = { label, href, subitems: parseOL($ol) }
        if (getType) result.type = $a?.getAttributeNS(NS.EPUB, 'type')?.split(/\s/)
        return result
    }
    const parseOL = ($ol, getType) => $ol ? $$($ol, 'li').map(parseLI(getType)) : null
    const parseNav = ($nav, getType) => parseOL($($nav, 'ol'), getType)

    const $$nav = $$$(doc, 'nav')
    let toc = null, pageList = null, landmarks = null, others = []
    for (const $nav of $$nav) {
        const type = $nav.getAttributeNS(NS.EPUB, 'type')?.split(/\s/) ?? []
        if (type.includes('toc')) toc ??= parseNav($nav)
        else if (type.includes('page-list')) pageList ??= parseNav($nav)
        else if (type.includes('landmarks')) landmarks ??= parseNav($nav, true)
        else others.push({
            label: getElementText($nav.firstElementChild), type,
            list: parseNav($nav),
        })
    }
    return { toc, pageList, landmarks, others }
}

const parseNCX = (doc, resolve = f => f) => {
    const { $, $$ } = childGetter(doc, NS.NCX)
    const resolveHref = href => href ? decodeURI(resolve(href)) : null
    const parseItem = el => {
        const $label = $(el, 'navLabel')
        const $content = $(el, 'content')
        const label = getElementText($label)
        const href = resolveHref($content.getAttribute('src'))
        if (el.localName === 'navPoint') {
            const els = $$(el, 'navPoint')
            return { label, href, subitems: els.length ? els.map(parseItem) : null }
        }
        return { label, href }
    }
    const parseList = (el, itemName) => $$(el, itemName).map(parseItem)
    const getSingle = (container, itemName) => {
        const $container = $(doc.documentElement, container)
        return $container ? parseList($container, itemName) : null
    }
    return {
        toc: getSingle('navMap', 'navPoint'),
        pageList: getSingle('pageList', 'pageTarget'),
        others: $$(doc.documentElement, 'navList').map(el => ({
            label: getElementText($(el, 'navLabel')),
            list: parseList(el, 'navTarget'),
        })),
    }
}

const parseClock = str => {
    if (!str) return
    const parts = str.split(':').map(x => parseFloat(x))
    if (parts.length === 3) {
        const [h, m, s] = parts
        return h * 60 * 60 + m * 60 + s
    }
    if (parts.length === 2) {
        const [m, s] = parts
        return m * 60 + s
    }
    const [x, unit] = str.split(/(?=[^\d.])/)
    const n = parseFloat(x)
    const f = unit === 'h' ? 60 * 60
        : unit === 'min' ? 60
        : unit === 'ms' ? .001
        : 1
    return n * f
}

class MediaOverlay extends EventTarget {
    #entries
    #lastMediaOverlayItem
    #sectionIndex
    #audioIndex
    #itemIndex
    #audio
    #volume = 1
    #rate = 1
    #state
    constructor(book, loadXML) {
        super()
        this.book = book
        this.loadXML = loadXML
    }
    async #loadSMIL(item) {
        if (this.#lastMediaOverlayItem === item) return
        const doc = await this.loadXML(item.href)
        const resolve = href => href ? resolveURL(href, item.href) : null
        const { $, $$$ } = childGetter(doc, NS.SMIL)
        this.#audioIndex = -1
        this.#itemIndex = -1
        this.#entries = $$$(doc, 'par').reduce((arr, $par) => {
            const text = resolve($($par, 'text')?.getAttribute('src'))
            const $audio = $($par, 'audio')
            if (!text || !$audio) return arr
            const src = resolve($audio.getAttribute('src'))
            const begin = parseClock($audio.getAttribute('clipBegin'))
            const end = parseClock($audio.getAttribute('clipEnd'))
            const last = arr.at(-1)
            if (last?.src === src) last.items.push({ text, begin, end })
            else arr.push({ src, items: [{ text, begin, end }] })
            return arr
        }, [])
        this.#lastMediaOverlayItem = item
    }
    get #activeAudio() {
        return this.#entries[this.#audioIndex]
    }
    get #activeItem() {
        return this.#activeAudio?.items?.[this.#itemIndex]
    }
    #error(e) {
        console.error(e)
        this.dispatchEvent(new CustomEvent('error', { detail: e }))
    }
    #highlight() {
        this.dispatchEvent(new CustomEvent('highlight', { detail: this.#activeItem }))
    }
    #unhighlight() {
        this.dispatchEvent(new CustomEvent('unhighlight', { detail: this.#activeItem }))
    }
    async #play(audioIndex, itemIndex) {
        this.#stop()
        this.#audioIndex = audioIndex
        this.#itemIndex = itemIndex
        const src = this.#activeAudio?.src
        if (!src || !this.#activeItem) return this.start(this.#sectionIndex + 1)

        const url = URL.createObjectURL(await this.book.loadBlob(src))
        const audio = new Audio(url)
        this.#audio = audio
        audio.volume = this.#volume
        audio.playbackRate = this.#rate
        audio.addEventListener('timeupdate', () => {
            if (audio.paused) return
            const t = audio.currentTime
            const { items } = this.#activeAudio
            if (t > this.#activeItem?.end) {
                this.#unhighlight()
                if (this.#itemIndex === items.length - 1) {
                    this.#play(this.#audioIndex + 1, 0).catch(e => this.#error(e))
                    return
                }
            }
            const oldIndex = this.#itemIndex
            while (items[this.#itemIndex + 1]?.begin <= t) this.#itemIndex++
            if (this.#itemIndex !== oldIndex) this.#highlight()
        })
        audio.addEventListener('error', () =>
            this.#error(new Error(`Failed to load ${src}`)))
        audio.addEventListener('playing', () => this.#highlight())
        audio.addEventListener('ended', () => {
            this.#unhighlight()
            URL.revokeObjectURL(url)
            this.#audio = null
            this.#play(audioIndex + 1, 0).catch(e => this.#error(e))
        })
        if (this.#state === 'paused') {
            this.#highlight()
            audio.currentTime = this.#activeItem.begin ?? 0
        }
        else audio.addEventListener('canplaythrough', () => {
            // for some reason need to seek in `canplaythrough`
            // or it won't play when skipping in WebKit
            audio.currentTime = this.#activeItem.begin ?? 0
            this.#state = 'playing'
            audio.play().catch(e => this.#error(e))
        }, { once: true })
    }
    async start(sectionIndex, filter = () => true) {
        this.#audio?.pause()
        const section = this.book.sections[sectionIndex]
        const href = section?.id
        if (!href) return

        const { mediaOverlay } = section
        if (!mediaOverlay) return this.start(sectionIndex + 1)
        this.#sectionIndex = sectionIndex
        await this.#loadSMIL(mediaOverlay)

        for (let i = 0; i < this.#entries.length; i++) {
            const { items } = this.#entries[i]
            for (let j = 0; j < items.length; j++) {
                if (items[j].text.split('#')[0] === href && filter(items[j], j, items))
                    return this.#play(i, j).catch(e => this.#error(e))
            }
        }
    }
    pause() {
        this.#state = 'paused'
        this.#audio?.pause()
    }
    resume() {
        this.#state = 'playing'
        this.#audio?.play().catch(e => this.#error(e))
    }
    #stop() {
        if (this.#audio) {
            this.#audio.pause()
            URL.revokeObjectURL(this.#audio.src)
            this.#audio = null
            this.#unhighlight()
        }
    }
    stop() {
        this.#state = 'stopped'
        this.#stop()
    }
    prev() {
        if (this.#itemIndex > 0) this.#play(this.#audioIndex, this.#itemIndex - 1)
        else if (this.#audioIndex > 0) this.#play(this.#audioIndex - 1,
            this.#entries[this.#audioIndex - 1].items.length - 1)
        else if (this.#sectionIndex > 0)
            this.start(this.#sectionIndex - 1, (_, i, items) => i === items.length - 1)
    }
    next() {
        this.#play(this.#audioIndex, this.#itemIndex + 1)
    }
    setVolume(volume) {
        this.#volume = volume
        if (this.#audio) this.#audio.volume = volume
    }
    setRate(rate) {
        this.#rate = rate
        if (this.#audio) this.#audio.playbackRate = rate
    }
}

const isUUID = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/

const getUUID = opf => {
    for (const el of opf.getElementsByTagNameNS(NS.DC, 'identifier')) {
        const [id] = getElementText(el).split(':').slice(-1)
        if (isUUID.test(id)) return id
    }
    return ''
}

const getIdentifier = opf => getElementText(
    opf.getElementById(opf.documentElement.getAttribute('unique-identifier'))
    ?? opf.getElementsByTagNameNS(NS.DC, 'identifier')[0])

// https://www.w3.org/publishing/epub32/epub-ocf.html#sec-resource-obfuscation
const deobfuscate = async (key, length, blob) => {
    const array = new Uint8Array(await blob.slice(0, length).arrayBuffer())
    length = Math.min(length, array.length)
    for (var i = 0; i < length; i++) array[i] = array[i] ^ key[i % key.length]
    return new Blob([array, blob.slice(length)], { type: blob.type })
}

const WebCryptoSHA1 = async str => {
    const data = new TextEncoder().encode(str)
    const buffer = await globalThis.crypto.subtle.digest('SHA-1', data)
    return new Uint8Array(buffer)
}

const deobfuscators = (sha1 = WebCryptoSHA1) => ({
    'http://www.idpf.org/2008/embedding': {
        key: opf => sha1(getIdentifier(opf)
            // eslint-disable-next-line no-control-regex
            .replaceAll(/[\u0020\u0009\u000d\u000a]/g, '')),
        decode: (key, blob) => deobfuscate(key, 1040, blob),
    },
    'http://ns.adobe.com/pdf/enc#RC': {
        key: opf => {
            const uuid = getUUID(opf).replaceAll('-', '')
            return Uint8Array.from({ length: 16 }, (_, i) =>
                parseInt(uuid.slice(i * 2, i * 2 + 2), 16))
        },
        decode: (key, blob) => deobfuscate(key, 1024, blob),
    },
})

class Encryption {
    #uris = new Map()
    #decoders = new Map()
    #algorithms
    constructor(algorithms) {
        this.#algorithms = algorithms
    }
    async init(encryption, opf) {
        if (!encryption) return
        const data = Array.from(
            encryption.getElementsByTagNameNS(NS.ENC, 'EncryptedData'), el => ({
                algorithm: el.getElementsByTagNameNS(NS.ENC, 'EncryptionMethod')[0]
                    ?.getAttribute('Algorithm'),
                uri: el.getElementsByTagNameNS(NS.ENC, 'CipherReference')[0]
                    ?.getAttribute('URI'),
            }))
        for (const { algorithm, uri } of data) {
            if (!this.#decoders.has(algorithm)) {
                const algo = this.#algorithms[algorithm]
                if (!algo) {
                    console.warn('Unknown encryption algorithm')
                    continue
                }
                const key = await algo.key(opf)
                this.#decoders.set(algorithm, blob => algo.decode(key, blob))
            }
            this.#uris.set(uri, algorithm)
        }
    }
    getDecoder(uri) {
        return this.#decoders.get(this.#uris.get(uri)) ?? (x => x)
    }
}

class Resources {
    constructor({ opf, resolveHref }) {
        this.opf = opf
        const { $, $$, $$$ } = childGetter(opf, NS.OPF)

        const $manifest = $(opf.documentElement, 'manifest')
        const $spine = $(opf.documentElement, 'spine')
        const $$itemref = $$($spine, 'itemref')

        this.manifest = $$($manifest, 'item')
            .map(getAttributes('href', 'id', 'media-type', 'properties', 'media-overlay'))
            .map(item => {
                item.href = resolveHref(item.href)
                item.properties = item.properties?.split(/\s/)
                return item
            })
        this.manifestById = new Map(this.manifest.map(item => [item.id, item]))
        this.spine = $$itemref
            .map(getAttributes('idref', 'id', 'linear', 'properties'))
            .map(item => (item.properties = item.properties?.split(/\s/), item))
        this.pageProgressionDirection = $spine
            .getAttribute('page-progression-direction')

        this.navPath = this.getItemByProperty('nav')?.href
        this.ncxPath = (this.getItemByID($spine.getAttribute('toc'))
            ?? this.manifest.find(item => item.mediaType === MIME.NCX))?.href

        const $guide = $(opf.documentElement, 'guide')
        if ($guide) this.guide = $$($guide, 'reference')
            .map(getAttributes('type', 'title', 'href'))
            .map(({ type, title, href }) => ({
                label: title,
                type: type.split(/\s/),
                href: resolveHref(href),
            }))

        this.cover = this.getItemByProperty('cover-image')
            // EPUB 2 compat
            ?? this.getItemByID($$$(opf, 'meta')
                .find(filterAttribute('name', 'cover'))
                ?.getAttribute('content'))
            ?? this.getItemByHref(this.guide
                ?.find(ref => ref.type.includes('cover'))?.href)

        this.cfis = CFI.fromElements($$itemref)
    }
    getItemByID(id) {
        return this.manifestById.get(id)
    }
    getItemByHref(href) {
        return this.manifest.find(item => item.href === href)
    }
    getItemByProperty(prop) {
        return this.manifest.find(item => item.properties?.includes(prop))
    }
    resolveCFI(cfi) {
        const parts = CFI.parse(cfi)
        const top = (parts.parent ?? parts).shift()
        let $itemref = CFI.toElement(this.opf, top)
        // make sure it's an idref; if not, try again without the ID assertion
        // mainly because Epub.js used to generate wrong ID assertions
        // https://github.com/futurepress/epub.js/issues/1236
        if ($itemref && $itemref.nodeName !== 'idref') {
            top.at(-1).id = null
            $itemref = CFI.toElement(this.opf, top)
        }
        const idref = $itemref?.getAttribute('idref')
        const index = this.spine.findIndex(item => item.idref === idref)
        const anchor = doc => CFI.toRange(doc, parts)
        return { index, anchor }
    }
}

/**
 * [shuge] 安全补丁：剥掉书里的活动内容。
 *
 * 章节文档会被序列化成 **同源 blob** 交给 iframe，而 iframe 的 sandbox 是
 * `allow-same-origin allow-scripts`（foliate 上游为了 WebKit 事件 bug 必须这么写）。
 * 两者同时放开等于没沙箱：书里的脚本能直接读到 App 源的 localStorage
 * （`shuge.webdav.v1` 里存着 WebDAV 应用密码）、IndexedDB 与 OPFS。
 * 实测一本带 <script> 的 epub 就能把密码读出来。
 *
 * 这里处理的 doc 来自 DOMParser，是惰性文档，脚本不会执行，所以可以安全清洗；
 * 清洗后再序列化。另在文档头塞一条 CSP 兜底（script-src 'none'），
 * 防止有从 SVG/内联属性漏过来的路径。
 */
const stripActiveContent = doc => {
    const ns = doc.documentElement?.namespaceURI
    // 1) 脚本元素
    for (const el of doc.querySelectorAll('script')) el.remove()
    // 2) on* 事件属性、javascript: 伪协议
    for (const el of doc.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) {
            const name = attr.name.toLowerCase()
            const value = attr.value.trim()
            if (name.startsWith('on')) el.removeAttribute(attr.name)
            else if (/^(href|src|xlink:href|formaction|action)$/.test(name)
                && /^\s*javascript:/i.test(value)) el.removeAttribute(attr.name)
            else if (name === 'style' && /expression\s*\(|javascript:/i.test(value)) {
                el.removeAttribute(attr.name)
            }
        }
    }
    // 3) CSP 兜底：只在有 <head> 的 HTML/XHTML 文档里有意义，SVG 跳过
    const head = doc.head ?? doc.querySelector('head')
    if (head && ns) {
        const meta = doc.createElementNS(ns, 'meta')
        meta.setAttribute('http-equiv', 'Content-Security-Policy')
        meta.setAttribute('content', "script-src 'none'; object-src 'none'")
        head.insertBefore(meta, head.firstChild)
    }
    return doc
}

class Loader {
    #cache = new Map()
    #children = new Map()
    #refCount = new Map()
    eventTarget = new EventTarget()
    constructor({ loadText, loadBlob, resources }) {
        this.loadText = loadText
        this.loadBlob = loadBlob
        this.manifest = resources.manifest
        this.assets = resources.manifest
        // needed only when replacing in (X)HTML w/o parsing (see below)
        //.filter(({ mediaType }) => ![MIME.XHTML, MIME.HTML].includes(mediaType))
    }
    async createURL(href, data, type, parent) {
        if (!data) return ''
        const detail = { data, type }
        Object.defineProperty(detail, 'name', { value: href }) // readonly
        const event = new CustomEvent('data', { detail })
        this.eventTarget.dispatchEvent(event)
        const newData = await event.detail.data
        const newType = await event.detail.type
        const url = URL.createObjectURL(new Blob([newData], { type: newType }))
        this.#cache.set(href, url)
        this.#refCount.set(href, 1)
        if (parent) {
            const childList = this.#children.get(parent)
            if (childList) childList.push(href)
            else this.#children.set(parent, [href])
        }
        return url
    }
    ref(href, parent) {
        const childList = this.#children.get(parent)
        if (!childList?.includes(href)) {
            this.#refCount.set(href, this.#refCount.get(href) + 1)
            //console.log(`referencing ${href}, now ${this.#refCount.get(href)}`)
            if (childList) childList.push(href)
            else this.#children.set(parent, [href])
        }
        return this.#cache.get(href)
    }
    unref(href) {
        if (!this.#refCount.has(href)) return
        const count = this.#refCount.get(href) - 1
        //console.log(`unreferencing ${href}, now ${count}`)
        if (count < 1) {
            //console.log(`unloading ${href}`)
            URL.revokeObjectURL(this.#cache.get(href))
            this.#cache.delete(href)
            this.#refCount.delete(href)
            // unref children
            const childList = this.#children.get(href)
            if (childList) while (childList.length) this.unref(childList.pop())
            this.#children.delete(href)
        } else this.#refCount.set(href, count)
    }
    // load manifest item, recursively loading all resources as needed
    async loadItem(item, parents = []) {
        if (!item) return null
        const { href, mediaType } = item

        const isScript = MIME.JS.test(item.mediaType)
        const detail = { type: mediaType, isScript, allow: true}
        const event = new CustomEvent('load', { detail })
        this.eventTarget.dispatchEvent(event)
        const allow = await event.detail.allow
        if (!allow) return null

        const parent = parents.at(-1)
        if (this.#cache.has(href)) return this.ref(href, parent)

        const shouldReplace =
            (isScript || [MIME.XHTML, MIME.HTML, MIME.CSS, MIME.SVG].includes(mediaType))
            // prevent circular references
            && parents.every(p => p !== href)
        if (shouldReplace) return this.loadReplaced(item, parents)
        // NOTE: this can be replaced with `Promise.try()`
        const tryLoadBlob = Promise.resolve().then(() => this.loadBlob(href))
        return this.createURL(href, tryLoadBlob, mediaType, parent)
    }
    async loadHref(href, base, parents = []) {
        if (isExternal(href)) return href
        const path = resolveURL(href, base)
        // [shuge] 多看系导出会把路径百分号编码、并留 ../ 未归一化，甚至 base 变成 blob: 导致
        // resolveURL 解析不出绝对路径。严格比较必失手 → 插图/样式/字体会静默失效。
        // 三级匹配：原样 → 解码+归一化 → 末尾路径段。
        const key = pathKey(path)
        const tail = key.replace(/^(\.\.\/)+/, '')
        const item = this.manifest.find(item => item.href === path)
            ?? this.manifest.find(item => pathKey(item.href) === key)
            ?? this.manifest.find(item => pathKey(item.href).endsWith('/' + tail))
        if (!item) {
            // [shuge] 部分书（如 Sony/老工具转制）zip 里有图片、manifest 却没登记，
            // 直接返回原相对路径会拼到 blob: base 上必然失效。按扩展名推断类型，直接当成资源加载。
            const mediaType = guessMediaType(path)
            if (mediaType) return this.loadItem({ href: path, mediaType }, parents.concat(base))
                .catch(() => href) // zip 里其实也没有该条目时保持原样，别让整篇文档加载失败
            return href
        }
        return this.loadItem(item, parents.concat(base))
    }
    async loadReplaced(item, parents = []) {
        const { href, mediaType } = item
        const parent = parents.at(-1)
        let str = ''
        try {
            str = await this.loadText(href)
        } catch (e) {
            return this.createURL(href, Promise.reject(e), mediaType, parent)
        }
        if (!str) return null

        // note that one can also just use `replaceString` for everything:
        // ```
        // const replaced = await this.replaceString(str, href, parents)
        // return this.createURL(href, replaced, mediaType, parent)
        // ```
        // which is basically what Epub.js does, which is simpler, but will
        // break things like iframes (because you don't want to replace links)
        // or text that just happen to be paths

        // parse and replace in HTML
        if ([MIME.XHTML, MIME.HTML, MIME.SVG].includes(mediaType)) {
            let doc = new DOMParser().parseFromString(str, mediaType)
            // change to HTML if it's not valid XHTML
            if (mediaType === MIME.XHTML && (doc.querySelector('parsererror')
            || !doc.documentElement?.namespaceURI)) {
                console.warn(doc.querySelector('parsererror')?.innerText ?? 'Invalid XHTML')
                item.mediaType = MIME.HTML
                doc = new DOMParser().parseFromString(str, item.mediaType)
            }
            // [shuge] 安全：先剥活动内容再往下走（详见 stripActiveContent 注释）
            doc = stripActiveContent(doc)
            // [shuge] 老工具常把 viewBox/preserveAspectRatio 写成全小写。XML 属性大小写敏感，
            // 失效后内嵌 <image> 按原始像素渲染，封面/插图被裁。这里做一次大小写归一化。
            for (const el of doc.querySelectorAll('svg')) {
                for (const [bad, good] of [['viewbox', 'viewBox'],
                    ['preserveaspectratio', 'preserveAspectRatio']]) {
                    if (el.hasAttribute(bad) && !el.hasAttribute(good)) {
                        el.setAttribute(good, el.getAttribute(bad))
                        el.removeAttribute(bad)
                    }
                }
            }
            // replace hrefs in XML processing instructions
            // this is mainly for SVGs that use xml-stylesheet
            if ([MIME.XHTML, MIME.SVG].includes(item.mediaType)) {
                let child = doc.firstChild
                while (child instanceof ProcessingInstruction) {
                    if (child.data) {
                        const replacedData = await replaceSeries(child.data,
                            /(?:^|\s*)(href\s*=\s*['"])([^'"]*)(['"])/i,
                            (_, p1, p2, p3) => this.loadHref(p2, href, parents)
                                .then(p2 => `${p1}${p2}${p3}`))
                        child.replaceWith(doc.createProcessingInstruction(
                            child.target, replacedData))
                    }
                    child = child.nextSibling
                }
            }
            // replace hrefs (excluding anchors)
            const replace = async (el, attr) => el.setAttribute(attr,
                await this.loadHref(el.getAttribute(attr), href, parents))
            for (const el of doc.querySelectorAll('link[href]')) await replace(el, 'href')
            for (const el of doc.querySelectorAll('[src]')) await replace(el, 'src')
            for (const el of doc.querySelectorAll('[poster]')) await replace(el, 'poster')
            for (const el of doc.querySelectorAll('object[data]')) await replace(el, 'data')
            for (const el of doc.querySelectorAll('[*|href]:not([href])'))
                el.setAttributeNS(NS.XLINK, 'href', await this.loadHref(
                    el.getAttributeNS(NS.XLINK, 'href'), href, parents))
            for (const el of doc.querySelectorAll('[srcset]'))
                el.setAttribute('srcset', await replaceSeries(el.getAttribute('srcset'),
                    /(\s*)(.+?)\s*((?:\s[\d.]+[wx])+\s*(?:,|$)|,\s+|$)/g,
                    (_, p1, p2, p3) => this.loadHref(p2, href, parents)
                        .then(p2 => `${p1}${p2}${p3}`)))
            // replace inline styles
            for (const el of doc.querySelectorAll('style'))
                if (el.textContent) el.textContent =
                    await this.replaceCSS(el.textContent, href, parents)
            for (const el of doc.querySelectorAll('[style]'))
                el.setAttribute('style',
                    await this.replaceCSS(el.getAttribute('style'), href, parents))
            // TODO: replace inline scripts? probably not worth the trouble
            const result = new XMLSerializer().serializeToString(doc)
            return this.createURL(href, result, item.mediaType, parent)
        }

        const result = mediaType === MIME.CSS
            ? await this.replaceCSS(str, href, parents)
            : await this.replaceString(str, href, parents)
        return this.createURL(href, result, mediaType, parent)
    }
    async replaceCSS(str, href, parents = []) {
        const replacedUrls = await replaceSeries(str,
            /url\(\s*["']?([^'"\n]*?)\s*["']?\s*\)/gi,
            (_, url) => this.loadHref(url, href, parents)
                .then(url => `url("${url}")`))
        // apart from `url()`, strings can be used for `@import` (but why?!)
        return replaceSeries(replacedUrls,
            /@import\s*["']([^"'\n]*?)["']/gi,
            (_, url) => this.loadHref(url, href, parents)
                .then(url => `@import "${url}"`))
    }
    // find & replace all possible relative paths for all assets without parsing
    replaceString(str, href, parents = []) {
        const assetMap = new Map()
        const urls = this.assets.map(asset => {
            // do not replace references to the file itself
            if (asset.href === href) return
            // href was decoded and resolved when parsing the manifest
            const relative = pathRelative(pathDirname(href), asset.href)
            const relativeEnc = encodeURI(relative)
            const rootRelative = '/' + asset.href
            const rootRelativeEnc = encodeURI(rootRelative)
            const set = new Set([relative, relativeEnc, rootRelative, rootRelativeEnc])
            for (const url of set) assetMap.set(url, asset)
            return Array.from(set)
        }).flat().filter(x => x)
        if (!urls.length) return str
        const regex = new RegExp(urls.map(regexEscape).join('|'), 'g')
        return replaceSeries(str, regex, async match =>
            this.loadItem(assetMap.get(match.replace(/^\//, '')),
                parents.concat(href)))
    }
    unloadItem(item) {
        this.unref(item?.href)
    }
    destroy() {
        for (const url of this.#cache.values()) URL.revokeObjectURL(url)
    }
}

const getHTMLFragment = (doc, id) => doc.getElementById(id)
    ?? doc.querySelector(`[name="${CSS.escape(id)}"]`)

const getPageSpread = properties => {
    for (const p of properties) {
        if (p === 'page-spread-left' || p === 'rendition:page-spread-left')
            return 'left'
        if (p === 'page-spread-right' || p === 'rendition:page-spread-right')
            return 'right'
        if (p === 'rendition:page-spread-center') return 'center'
    }
}

const getDisplayOptions = doc => {
    if (!doc) return null
    return {
        fixedLayout: getElementText(doc.querySelector('option[name="fixed-layout"]')),
        openToSpread: getElementText(doc.querySelector('option[name="open-to-spread"]')),
    }
}

export class EPUB {
    parser = new DOMParser()
    #loader
    #encryption
    constructor({ loadText, loadBlob, getSize, sha1, entries }) {
        // [shuge] zip 条目列表：OPF 丢失时可据此合成 package（见 #synthesizePackage）
        this.entries = entries?.map(e => e.filename) ?? null
        // [shuge] 多看等工具会把 manifest 里的 href 做百分号编码，而 zip 内实际条目名是解码后的，
        // 直接按 href 查条目会全部落空：章节渲染空白、goTo 抛 "reading 'element'"。
        // 这里在取不到内容时用解码后的路径重试一次。
        const decodedAlt = uri => {
            // 必须用 decodeURIComponent：decodeURI 不会解 %3A / %2F 这类保留字符，
            // 而多看混淆出来的文件名里恰恰全是这些。
            for (const fn of [decodeURIComponent, decodeURI]) {
                try {
                    const d = fn(uri)
                    if (d !== uri) return d
                } catch {
                    /* 非法编码，换下一个 */
                }
            }
            return null
        }
        const withDecodeFallback = fn => fn && (async (uri, ...rest) => {
            const res = await fn(uri, ...rest)
            if (res != null) return res
            const alt = decodedAlt(uri)
            return alt ? fn(alt, ...rest) : res
        })
        this.loadText = withDecodeFallback(loadText)
        this.loadBlob = withDecodeFallback(loadBlob)
        this.getSize = getSize && (uri => getSize(uri)
            || (decodedAlt(uri) ? getSize(decodedAlt(uri)) : 0))
        this.#encryption = new Encryption(deobfuscators(sha1))
    }
    async #loadXML(uri) {
        // [shuge] 条目损坏（local header 被清零）时 zip.js 会拒绝读取，
        // 这里当作"没有这个文件"处理，而不是让整本书导入失败。
        let str
        try {
            str = await this.loadText(uri)
        } catch {
            return null
        }
        if (!str) return null
        let doc = this.parser.parseFromString(str, MIME.XML)
        if (doc.querySelector('parsererror'))
            throw new Error(`XML parsing error: ${uri}
${doc.querySelector('parsererror').innerText}`)
        // [shuge] 部分国产导出工具（多看/起点）把 OPF 整个包在 <html><body> 里，
        // 导致 documentElement 不是 <package>，下游 metadata/spine/resources 全部取不到，
        // 报 "Cannot read properties of undefined (reading 'children')"。
        // 这里把 <package> 单独序列化后重新解析，还原成标准结构。
        if (doc.documentElement?.localName !== 'package') {
            const pkg = doc.getElementsByTagNameNS('*', 'package')[0]
            if (pkg) {
                const retry = this.parser.parseFromString(
                    new XMLSerializer().serializeToString(pkg), MIME.XML)
                if (!retry.querySelector('parsererror')) doc = retry
            }
        }
        return doc
    }
    /** [shuge] 封面页当封面用的兜底：从 cover.html 里抠出第一张图，返回图片 item。 */
    async #coverFromPage(pageHref) {
        let html
        try {
            html = await this.loadText(pageHref)
        } catch {
            return null
        }
        if (!html) return null
        // 封面页结构各异（<img src> / <svg><image xlink:href>），不解析 DOM 只用属性匹配
        const m = /<(?:img|image)\b[^>]*?(?:xlink:href|src)\s*=\s*["']([^"']+)["']/i.exec(html)
        if (!m) return null
        const abs = resolveURL(m[1], pageHref)
        if (!abs) return null
        const item = this.resources?.getItemByHref(abs)
        if (item) return item
        const mediaType = guessMediaType(abs)
        return mediaType ? { href: abs, mediaType } : null
    }
    /**
     * [shuge] OPF 丢失时的兜底：用 zip 条目列表 + NCX 合成一个最小 package。
     * 典型场景：文件开头的字节被抹成 0x00（流氓压制/下载残缺），恰好盖住 mimetype、
     * container.xml、content.opf，但 toc.ncx 与章节正文完好。静读天下这类阅读器能开，
     * 就是走了类似的降级路径。
     */
    async #synthesizePackage() {
        const names = this.entries
        if (!names?.length) return null
        const isHTML = n => /\.(xhtml|html|htm)$/i.test(n) && !n.startsWith('META-INF/')
        const htmls = names.filter(isHTML)
        if (!htmls.length) return null
        const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
        htmls.sort(natural)
        const dir = htmls[0].includes('/') ? htmls[0].slice(0, htmls[0].lastIndexOf('/') + 1) : ''
        const toRel = target => {
            const t = target.split('/')
            const b = dir.split('/').filter(Boolean)
            let i = 0
            while (i < b.length && t[i] === b[i]) i++
            return [...Array(b.length - i).fill('..'), ...t.slice(i)].join('/')
        }
        const ncx = names.find(n => /\.ncx$/i.test(n) && n.startsWith(dir))
            ?? names.find(n => /\.ncx$/i.test(n)) ?? null

        // spine 顺序优先取 NCX 的阅读顺序（绝大多数书都有，且是真章节名）
        let order = htmls
        if (ncx) {
            const ncxDoc = await this.#loadXML(ncx)
            if (ncxDoc) {
                const ncDir = ncx.includes('/') ? ncx.slice(0, ncx.lastIndexOf('/') + 1) : ''
                const seen = new Set()
                const ordered = []
                for (const el of [...ncxDoc.getElementsByTagName('content')]) {
                    const src = el.getAttribute('src')?.split('#')[0]
                    if (!src) continue
                    const abs = resolveURL(src, ncDir)
                    if (!abs || seen.has(abs) || !htmls.includes(abs)) continue
                    seen.add(abs)
                    ordered.push(abs)
                }
                if (ordered.length) order = ordered.concat(htmls.filter(n => !seen.has(n)))
            }
        }

        // [shuge] 封面嗅探：OPF 丢了，封面清单也跟着丢，但封面图基本都还在包里。
        // 先按文件名（cover.jpg），再多看生成的 cover~slim 是整页长图，必须排除；
        // 都找不到就退到封面页里的首图（cover.xhtml 常把封面塞在 <svg><image> 里）。
        const isImagePath = n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n)
        const isThumb = n => /(~slim|-slim|_slim|thumb|_small)/i.test(n)
        let coverPath = names.find(n => isImagePath(n)
                && /(^|\/)cover\.(jpe?g|png|gif|webp|bmp)$/i.test(n))
            ?? names.find(n => isImagePath(n) && /cover/i.test(n) && !isThumb(n))
        const coverPage = names.find(n => /(^|\/)cover[^/]*\.(x?html?)$/i.test(n))
            ?? names.find(n => /(^|\/)title ?page[^/]*\.(x?html?)$/i.test(n))
        if (!coverPath) {
            const doc = coverPage ? await this.#loadXML(coverPage) : null
            const el = doc ? [...doc.getElementsByTagName('*')]
                .find(e => /^(img|image)$/i.test(e.localName)) : null
            const src = el && (el.getAttribute('src')
                || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
                || el.getAttribute('xlink:href'))
            const abs = src && coverPage ? resolveURL(src, coverPage) : null
            if (abs && names.includes(abs)) coverPath = abs
        }
        // 封面页归位到 spine 最前（原书里它本来就是第一页，NCX 一般不含它）
        if (coverPage && htmls.includes(coverPage) && order[0] !== coverPage)
            order = [coverPage, ...order.filter(n => n !== coverPage)]

        const esc = s => String(s).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/>/g, '&gt;')
        const items = order.map((href, i) =>
            `<item id="s${i}" href="${esc(toRel(href))}" media-type="application/xhtml+xml"/>`)
        if (ncx) items.push(
            `<item id="ncx" href="${esc(toRel(ncx))}" media-type="application/x-dtbncx+xml"/>`)
        if (coverPath) items.push(
            `<item id="cover-image" href="${esc(toRel(coverPath))}"`
            + ` media-type="${guessMediaType(coverPath) ?? 'image/jpeg'}" properties="cover-image"/>`)
        const refs = order.map((_, i) => `<itemref idref="s${i}"/>`)
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:shuge-synthetic</dc:identifier>
<dc:title></dc:title><dc:language>zh</dc:language>
</metadata>
<manifest>${items.join('')}</manifest>
<spine${ncx ? ' toc="ncx"' : ''}>${refs.join('')}</spine>
</package>`
        const doc = this.parser.parseFromString(xml, MIME.XML)
        if (doc.querySelector('parsererror')) return null
        console.info(`[shuge] OPF 缺失，已用 ${order.length} 个章节${ncx ? ' + NCX' : ''}合成 package`
            + `，封面：${coverPath ?? '未找到'}`)
        return { path: dir + '__synthetic__.opf', doc }
    }
    async init() {
        // [shuge] 不再因 container/OPF 缺失直接抛错：先尝试合成 package（损坏书兜底）
        let opfPath = null
        let opf = null
        const $container = await this.#loadXML('META-INF/container.xml')
        if ($container) {
            const opfs = Array.from(
                $container.getElementsByTagNameNS(NS.CONTAINER, 'rootfile'),
                getAttributes('full-path', 'media-type'))
                .filter(file => file.mediaType === 'application/oebps-package+xml')
            if (opfs.length) {
                opfPath = opfs[0].fullPath
                opf = await this.#loadXML(opfPath)
            }
        }
        if (!opf) {
            const synth = await this.#synthesizePackage()
            if (!synth) throw new Error('Failed to load package document')
            opfPath = synth.path
            opf = synth.doc
        }

        const $encryption = await this.#loadXML('META-INF/encryption.xml')
        await this.#encryption.init($encryption, opf)

        this.resources = new Resources({
            opf,
            resolveHref: url => resolveURL(url, opfPath),
        })
        // [shuge] guide 的 cover reference 经常指向封面页（.html/.xhtml）而不是图片，
        // 上游把这段 HTML 原样当图片 blob 存下来 → 书架上图片存在但解码失败（naturalWidth=0）。
        // 这里改成打开封面页，从里面取第一张图。
        if (this.resources.cover && !(this.resources.cover.mediaType ?? '').startsWith('image/')) {
            this.resources.cover = await this.#coverFromPage(this.resources.cover.href) ?? null
        }
        // [shuge] 有些包 OPF 完好却没声明封面（多看系导出常见），三条标准路径
        // （cover-image / meta[name=cover] / guide）全落空 → 书架一片占位图。
        // 包里既然有 cover.jpg，就按文件名认一张；多看另生成的 cover~slim 是整页长图，排除。
        if (!this.resources.cover && this.entries) {
            const isImg = n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n)
            const isThumb = n => /(~slim|-slim|_slim|thumb|_small)/i.test(n)
            const path = this.entries.find(n => isImg(n)
                    && /(^|\/)cover\.(jpe?g|png|gif|webp|bmp)$/i.test(n))
                ?? this.entries.find(n => isImg(n) && /cover/i.test(n) && !isThumb(n))
            if (path) this.resources.cover = {
                href: path,
                mediaType: guessMediaType(path) ?? 'image/jpeg',
            }
        }
        this.#loader = new Loader({
            loadText: this.loadText,
            loadBlob: uri => Promise.resolve(this.loadBlob(uri))
                .then(this.#encryption.getDecoder(uri)),
            resources: this.resources,
        })
        this.transformTarget = this.#loader.eventTarget
        this.sections = this.resources.spine.map((spineItem, index) => {
            const { idref, linear, properties = [] } = spineItem
            const item = this.resources.getItemByID(idref)
            if (!item) {
                console.warn(`Could not find item with ID "${idref}" in manifest`)
                return null
            }
            return {
                id: item.href,
                load: () => this.#loader.loadItem(item),
                unload: () => this.#loader.unloadItem(item),
                createDocument: () => this.loadDocument(item),
                size: this.getSize(item.href),
                cfi: this.resources.cfis[index],
                linear,
                pageSpread: getPageSpread(properties),
                resolveHref: href => resolveURL(href, item.href),
                mediaOverlay: item.mediaOverlay
                    ? this.resources.getItemByID(item.mediaOverlay) : null,
            }
        }).filter(s => s)

        const { navPath, ncxPath } = this.resources
        if (navPath) try {
            const resolve = url => resolveURL(url, navPath)
            const nav = parseNav(await this.#loadXML(navPath), resolve)
            this.toc = nav.toc
            this.pageList = nav.pageList
            this.landmarks = nav.landmarks
        } catch(e) {
            console.warn(e)
        }
        if (!this.toc && ncxPath) try {
            const resolve = url => resolveURL(url, ncxPath)
            const ncx = parseNCX(await this.#loadXML(ncxPath), resolve)
            this.toc = ncx.toc
            this.pageList = ncx.pageList
        } catch(e) {
            console.warn(e)
        }
        this.landmarks ??= this.resources.guide

        const { metadata, rendition, media } = getMetadata(opf)
        this.metadata = metadata
        this.rendition = rendition
        this.media = media
        this.dir = this.resources.pageProgressionDirection
        const displayOptions = getDisplayOptions(
            await this.#loadXML('META-INF/com.apple.ibooks.display-options.xml')
            ?? await this.#loadXML('META-INF/com.kobobooks.display-options.xml'))
        if (displayOptions) {
            if (displayOptions.fixedLayout === 'true')
                this.rendition.layout ??= 'pre-paginated'
            if (displayOptions.openToSpread === 'false') this.sections
                .find(section => section.linear !== 'no').pageSpread ??=
                    this.dir === 'rtl' ? 'left' : 'right'
        }
        return this
    }
    async loadDocument(item) {
        const str = await this.loadText(item.href)
        return this.parser.parseFromString(str, item.mediaType)
    }
    getMediaOverlay() {
        return new MediaOverlay(this, this.#loadXML.bind(this))
    }
    resolveCFI(cfi) {
        return this.resources.resolveCFI(cfi)
    }
    resolveHref(href) {
        const [path, hash] = href.split('#')
        const item = this.resources.getItemByHref(decodeURI(path))
        if (!item) return null
        const index = this.resources.spine.findIndex(({ idref }) => idref === item.id)
        const anchor = hash ? doc => getHTMLFragment(doc, hash) : () => 0
        return { index, anchor }
    }
    splitTOCHref(href) {
        return href?.split('#') ?? []
    }
    getTOCFragment(doc, id) {
        return doc.getElementById(id)
            ?? doc.querySelector(`[name="${CSS.escape(id)}"]`)
    }
    isExternal(uri) {
        return isExternal(uri)
    }
    async getCover() {
        const cover = this.resources?.cover
        if (!cover?.href) return null
        let data
        try {
            data = await this.loadBlob(cover.href)
        } catch {
            return null
        }
        // [shuge] 读不到数据时不能 new Blob([null])：那会得到内容为 "null" 的 4 字节 blob，
        // 存进书架变成"有 img 但 naturalWidth=0"的破图，比没封面更难排查。
        return data ? new Blob([data], { type: cover.mediaType }) : null
    }
    async getCalibreBookmarks() {
        const txt = await this.loadText('META-INF/calibre_bookmarks.txt')
        const magic = 'encoding=json+base64:'
        if (txt?.startsWith(magic)) {
            const json = atob(txt.slice(magic.length))
            return JSON.parse(json)
        }
    }
    destroy() {
        this.#loader?.destroy()
    }
}
