export function composeShareText({ note, url, defaultText }) {
  if (note && note.trim()) {
    return `${note.trim()}\n\n${url}`
  }
  if (defaultText && defaultText.trim()) {
    return `${defaultText.trim()}\n${url}`
  }
  return url
}
