import { searchKey } from '../payments/paymentsApi'

function wildcardTerm(term: string) {
  const parts = term.split('*').filter(Boolean)
  const anchoredStart = !term.startsWith('*')
  const anchoredEnd = !term.endsWith('*')
  const wordCharacter = /[^\p{L}\p{N}*]/u.test(term) ? /\S/ : /[\p{L}\p{N}]/u

  return (text: string) => {
    let from = 0
    for (const [index, part] of parts.entries()) {
      const checkStart = index === 0 && anchoredStart
      const checkEnd = index === parts.length - 1 && anchoredEnd
      let match = text.indexOf(part, from)
      while (match >= 0 && (
        (checkStart && wordCharacter.test(text[match - 1] ?? ''))
        || (checkEnd && wordCharacter.test(text[match + part.length] ?? ''))
      )) {
        match = text.indexOf(part, match + 1)
      }
      if (match < 0) return false
      from = match + part.length
    }
    return true
  }
}

export function catalogSearch(query: string) {
  const term = searchKey(query.trim()).replace(/\\\*/g, '*')
  if (!term) return () => true
  if (!term.includes('*')) return (text: string) => searchKey(text).includes(term)

  // Accept a spaced closing wildcard such as "*gold *".
  const terms = term.replace(/(\S)\s+\*(?=\s|$)/g, '$1*').split(/\s+/).filter((part) => /[^*]/.test(part))
  const literals = terms.filter((part) => !part.includes('*'))
  const patterns = terms.filter((part) => part.includes('*')).map(wildcardTerm)

  return (text: string) => {
    const key = searchKey(text)
    return literals.every((part) => key.includes(part)) && patterns.every((match) => match(key))
  }
}
