import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache

DAYS = 3
CENTS = 5
ADMIN_CODE = "---"
ADMIN_NAME = re.compile(r"\s*(?:skroutz|skroytz|skourtz|σκρουτζ)[\s\-–—_:]+admin\s*", re.IGNORECASE)

GREEK = str.maketrans(dict(zip(
    "αβγδεζηθικλμνξοπρστυφχψω",
    ("a", "v", "g", "d", "e", "z", "i", "th", "i", "k", "l", "m", "n", "x", "o", "p",
     "r", "s", "t", "u", "f", "ch", "ps", "o"),
)))
EXTRA_WORDS = {"orofo", "orofos", "orofou"}
MARKETPLACE_PREFIX = re.compile(r"^\s*(?:skroutz|skourtz)\s*[-–—:]\s*")
GREEKLISH_FORMS = {
    "mp": "b", "nt": "d", "gk": "g", "ng": "g",
    "ch": "x", "kh": "x", "ks": "x",
    "ou": "u", "ei": "i", "oi": "i", "ev": "eu", "ef": "eu",
    "h": "i", "c": "k",
}
GREEKLISH_PATTERN = re.compile(r"nt(?![sz])|mp|gk|ng|ch|kh|ks|ou|ei|oi|ev|ef|th|h|c")


@dataclass(frozen=True)
class Order:
    row: int
    reference: str
    day: date
    name: str
    cents: int | None

    @property
    def is_admin(self) -> bool:
        return ADMIN_NAME.fullmatch(self.name) is not None


@dataclass(frozen=True)
class Customer:
    code: str
    day: date
    name: str
    cents: int


def name_tokens(name: str) -> tuple[str, ...]:
    text = unicodedata.normalize("NFD", name.casefold())
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).translate(GREEK)
    text = MARKETPLACE_PREFIX.sub("", text)
    words = re.findall(r"[a-z]+\d*|\d+[a-z]*", text)
    # Join runs of initials such as the company suffix O E.
    words = re.sub(r"(?:\b[a-z] ){1,}[a-z]\b", lambda match: match[0].replace(" ", ""), " ".join(words)).split()
    tokens = (
        word.replace("av", "au").replace("ay", "au").replace("y", "u").replace("ph", "f")
        for word in words if word.isalpha() and word not in EXTRA_WORDS
    )
    return tuple(dict.fromkeys(word for word in tokens if 2 <= len(word) <= 80))


def greeklish_key(token: str) -> str:
    folded = GREEKLISH_PATTERN.sub(lambda match: GREEKLISH_FORMS.get(match[0], match[0]), token)
    return re.sub(r"([b-df-hj-np-tv-z])\1+", r"\1", folded)


def name_keys(name: str) -> tuple[tuple[str, ...], tuple[str, ...], bool]:
    plain = name_tokens(name)
    latin = bool(re.search(r"[a-zA-Z]", MARKETPLACE_PREFIX.sub("", name.casefold())))
    return plain, tuple(dict.fromkeys(map(greeklish_key, plain))), latin


def near_token(first: str, second: str) -> bool:
    if min(len(first), len(second)) < 5 or abs(len(first) - len(second)) > 1:
        return False
    if len(first) != len(second):
        short, long = sorted((first, second), key=len)
        return any(long[:i] + long[i + 1:] == short for i in range(len(long)))
    differences = [i for i, pair in enumerate(zip(first, second)) if pair[0] != pair[1]]
    if len(differences) == 1:
        return True
    if len(differences) == 2:
        i, j = differences
        return j == i + 1 and first[i] == second[j] and first[j] == second[i]
    return False


def name_strength(order: tuple[str, ...], erp: tuple[str, ...]) -> int:
    shared = set(order).intersection(erp)
    # Require every ERP name token, allowing one typo alongside an exact token.
    if len(erp) >= 2 and len(shared) == len(erp) and any(len(word) >= 4 for word in shared):
        return 2
    if shared and len(erp) - len(shared) == 1:
        missing = next(word for word in erp if word not in shared)
        if any(near_token(word, missing) for word in order if word not in shared):
            return 1
    return 0


def compare_names(order_keys, erp_keys) -> int:
    order, order_folded, order_latin = order_keys
    erp, erp_folded, erp_latin = erp_keys
    exact = name_strength(order, erp)
    if exact == 2:
        return 3
    if (order_latin or erp_latin) and name_strength(order_folded, erp_folded) == 2:
        return 2
    return exact


def reconcile(orders: list[Order], customers: list[Customer]) -> list[dict]:
    indexed = defaultdict(list)
    keys_for = lru_cache(maxsize=4096)(name_keys)
    for customer in customers:
        indexed[customer.day.toordinal(), customer.cents].append(customer)

    result = []
    for order in orders:
        candidates = {}
        is_admin = order.is_admin
        if not is_admin and order.cents is not None:
            keys = keys_for(order.name)
            day = order.day.toordinal()
            for day_delta in range(-DAYS, DAYS + 1):
                for cents_delta in range(-CENTS, CENTS + 1):
                    for customer in indexed.get((day + day_delta, order.cents + cents_delta), ()):
                        strength = compare_names(keys, keys_for(customer.name))
                        if strength:
                            rank = (-strength, abs(cents_delta), abs(day_delta))
                            previous = candidates.get(customer.code)
                            if previous is None or rank < previous[0]:
                                candidates[customer.code] = (rank, customer)

        ranked = sorted(candidates.values(), key=lambda pair: pair[0])
        matched = ranked[0][1] if len(ranked) == 1 else None
        result.append({
            "row": order.row,
            "reference": order.reference,
            "date": order.day,
            "name": order.name,
            "cents": order.cents,
            "code": ADMIN_CODE if is_admin else (matched.code if matched else ""),
            "isAdmin": is_admin,
            "erpName": matched.name if matched else "",
            "candidateCount": len(ranked),
            "candidates": [
                {"code": customer.code, "name": customer.name, "date": customer.day, "cents": customer.cents}
                for _, customer in ranked[:10]
            ] if len(ranked) > 1 else [],
        })
    return result


def period(orders: list[Order]) -> dict:
    days = [order.day for order in orders]
    return {
        "start": min(days),
        "end": max(days),
        "erpStart": min(days) - timedelta(days=DAYS),
        "erpEnd": max(days) + timedelta(days=DAYS),
        "count": len(orders),
    }
