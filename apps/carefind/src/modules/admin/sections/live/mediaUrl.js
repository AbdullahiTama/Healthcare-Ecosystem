// Media content comes from the database: it is only ever loaded from an
// http(s) URL (never javascript:, data: or a relative path).
export const isHttpUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url)
