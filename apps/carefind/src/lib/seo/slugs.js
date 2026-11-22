// Readable, stable URLs for public pages: a keyword slug, then the record's id, e.g.
//   /business/medplus-pharmacy-ikeja-lagos-0b6f…-…   /u/dr-ada-obi-pharmacist-…   /news/<headline>-<id>
// The id at the end is what is looked up, so a renamed business keeps working (old URLs point to the new canonical).
// Medicines are looked up by name: /drug/<name, URL-encoded, lower case>.

const UUID_AT_END = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function slugify(text, max = 70) {
  const s = String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  return cut.slice(0, cut.lastIndexOf('-') > max * 0.5 ? cut.lastIndexOf('-') : max).replace(/-+$/g, '')
}

// The id in a route parameter: the bare id, or the id at the end of "<slug>-<id>". Null when there is none.
export function idFromParam(param) {
  const v = String(param || '').trim()
  if (UUID.test(v)) return v.toLowerCase()
  const m = UUID_AT_END.exec(v)
  return m ? m[1].toLowerCase() : null
}

const withSlug = (prefix, words, id) => {
  const slug = slugify(words.filter(Boolean).join(' '))
  return `/${prefix}/${slug ? slug + '-' : ''}${id}`
}

export const businessPath = (b) => withSlug('business', [b?.name, b?.city, b?.state], b?.id)
export const professionalPath = (p) => withSlug('u', [p?.full_name || p?.display_name, p?.specialty || p?.verification_label], p?.id)
export const newsPath = (n) => withSlug('news', [n?.headline], n?.id)
export const postPath = (p, title) => withSlug('post', [title], p?.id)
export const medicineName = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()
export const medicinePath = (name) => '/drug/' + encodeURIComponent(medicineName(name))
