import re
import unicodedata


def search_key(value: str) -> str:
    return "".join(
        character for character in unicodedata.normalize("NFD", value)
        if not unicodedata.category(character).startswith("M")
    ).lower()


def wildcard_term(term: str):
    parts = [part for part in term.split("*") if part]
    anchored_start = not term.startswith("*")
    anchored_end = not term.endswith("*")
    has_punctuation = any(not character.isalnum() and character != "*" for character in term)

    def word_character(character):
        return bool(character) and (not character.isspace() if has_punctuation else character.isalnum())

    def matches(text):
        start = 0
        for index, part in enumerate(parts):
            check_start = index == 0 and anchored_start
            check_end = index == len(parts) - 1 and anchored_end
            match = text.find(part, start)
            while match >= 0:
                end = match + len(part)
                if not (
                    (check_start and word_character(text[match - 1:match]))
                    or (check_end and word_character(text[end:end + 1]))
                ):
                    break
                match = text.find(part, match + 1)
            if match < 0:
                return False
            start = match + len(part)
        return True

    return matches


def catalog_search(query: str):
    # Keep the server-side filter in sync with the Orders catalog search.
    term = search_key(query.strip()).replace(r"\*", "*")
    if "*" not in term:
        return lambda text: term in search_key(text)

    terms = re.sub(r"(\S)\s+\*(?=\s|$)", r"\1*", term).split()
    literals = [part for part in terms if "*" not in part]
    patterns = [wildcard_term(part) for part in terms if "*" in part and part.strip("*")]

    def matches(text):
        key = search_key(text)
        return all(part in key for part in literals) and all(pattern(key) for pattern in patterns)

    return matches
