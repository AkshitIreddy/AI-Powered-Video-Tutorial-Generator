"""Deterministic English speech text shared by narration and alignment.

The authored script remains unchanged in the storyboard.  This module creates
the exact text sent to both TTS and the English CTC aligner so a mathematical
symbol can never disappear from only one side of the acoustic contract.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


class SpokenTextError(ValueError):
    """The authored narration cannot be represented by the supported speech contract."""


@dataclass(frozen=True, slots=True)
class SpokenText:
    authored_text: str
    spoken_text: str


_ONES = (
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
)
_TENS = (
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
)
_SCALES = (
    (1_000_000_000_000, "trillion"),
    (1_000_000_000, "billion"),
    (1_000_000, "million"),
    (1_000, "thousand"),
)
_ORDINALS = {
    "zero": "zeroth",
    "one": "first",
    "two": "second",
    "three": "third",
    "four": "fourth",
    "five": "fifth",
    "six": "sixth",
    "seven": "seventh",
    "eight": "eighth",
    "nine": "ninth",
    "ten": "tenth",
    "eleven": "eleventh",
    "twelve": "twelfth",
    "thirteen": "thirteenth",
    "fourteen": "fourteenth",
    "fifteen": "fifteenth",
    "sixteen": "sixteenth",
    "seventeen": "seventeenth",
    "eighteen": "eighteenth",
    "nineteen": "nineteenth",
    "twenty": "twentieth",
    "thirty": "thirtieth",
    "forty": "fortieth",
    "fifty": "fiftieth",
    "sixty": "sixtieth",
    "seventy": "seventieth",
    "eighty": "eightieth",
    "ninety": "ninetieth",
    "hundred": "hundredth",
    "thousand": "thousandth",
    "million": "millionth",
    "billion": "billionth",
    "trillion": "trillionth",
}
_UNSUPPORTED = re.compile(r"[^A-Za-z\s.,!?;:'\"]")
_SPOKEN_SYMBOLS = (
    ("\N{GREEK CAPITAL LETTER ALPHA}", " alpha "),
    ("\N{GREEK SMALL LETTER ALPHA}", " alpha "),
    ("\N{GREEK CAPITAL LETTER BETA}", " beta "),
    ("\N{GREEK SMALL LETTER BETA}", " beta "),
    ("\N{GREEK CAPITAL LETTER GAMMA}", " gamma "),
    ("\N{GREEK SMALL LETTER GAMMA}", " gamma "),
    ("\N{GREEK CAPITAL LETTER DELTA}", " delta "),
    ("\N{GREEK SMALL LETTER DELTA}", " delta "),
    ("\N{GREEK CAPITAL LETTER EPSILON}", " epsilon "),
    ("\N{GREEK SMALL LETTER EPSILON}", " epsilon "),
    ("\N{GREEK CAPITAL LETTER ETA}", " eta "),
    ("\N{GREEK SMALL LETTER ETA}", " eta "),
    ("\N{GREEK CAPITAL LETTER THETA}", " theta "),
    ("\N{GREEK SMALL LETTER THETA}", " theta "),
    ("\N{GREEK CAPITAL LETTER KAPPA}", " kappa "),
    ("\N{GREEK SMALL LETTER KAPPA}", " kappa "),
    ("\N{GREEK CAPITAL LETTER LAMDA}", " lambda "),
    ("\N{GREEK SMALL LETTER LAMDA}", " lambda "),
    ("\N{GREEK CAPITAL LETTER MU}", " mu "),
    ("\N{GREEK SMALL LETTER MU}", " mu "),
    ("\N{GREEK CAPITAL LETTER NU}", " nu "),
    ("\N{GREEK SMALL LETTER NU}", " nu "),
    ("\N{GREEK CAPITAL LETTER XI}", " xi "),
    ("\N{GREEK SMALL LETTER XI}", " xi "),
    ("\N{GREEK CAPITAL LETTER PI}", " pi "),
    ("\N{GREEK SMALL LETTER PI}", " pi "),
    ("\N{GREEK CAPITAL LETTER RHO}", " rho "),
    ("\N{GREEK SMALL LETTER RHO}", " rho "),
    ("\N{GREEK CAPITAL LETTER SIGMA}", " sigma "),
    ("\N{GREEK SMALL LETTER SIGMA}", " sigma "),
    ("\N{GREEK CAPITAL LETTER TAU}", " tau "),
    ("\N{GREEK SMALL LETTER TAU}", " tau "),
    ("\N{GREEK CAPITAL LETTER PHI}", " phi "),
    ("\N{GREEK SMALL LETTER PHI}", " phi "),
    ("\N{GREEK CAPITAL LETTER CHI}", " chi "),
    ("\N{GREEK SMALL LETTER CHI}", " chi "),
    ("\N{GREEK CAPITAL LETTER PSI}", " psi "),
    ("\N{GREEK SMALL LETTER PSI}", " psi "),
    ("\N{GREEK CAPITAL LETTER OMEGA}", " omega "),
    ("\N{GREEK SMALL LETTER OMEGA}", " omega "),
    ("\N{INFINITY}", " infinity "),
    ("\N{MULTIPLICATION SIGN}", " times "),
    ("\N{DIVISION SIGN}", " divided by "),
    ("\N{MINUS SIGN}", " minus "),
    ("\N{PLUS-MINUS SIGN}", " plus or minus "),
    ("\N{ALMOST EQUAL TO}", " approximately "),
    ("\N{NOT EQUAL TO}", " not equal to "),
    ("\N{LESS-THAN OR EQUAL TO}", " less than or equal to "),
    ("\N{GREATER-THAN OR EQUAL TO}", " greater than or equal to "),
    ("\N{RIGHTWARDS ARROW}", " arrow "),
    ("\N{RIGHTWARDS DOUBLE ARROW}", " implies "),
    ("\N{N-ARY SUMMATION}", " sum of "),
    ("\N{INTEGRAL}", " integral of "),
    ("\N{PARTIAL DIFFERENTIAL}", " partial derivative of "),
    ("\N{ELEMENT OF}", " is an element of "),
    ("\N{NOT AN ELEMENT OF}", " is not an element of "),
    ("\N{UNION}", " union "),
    ("\N{INTERSECTION}", " intersection "),
    ("\N{SQUARE ROOT}", " square root of "),
    ("\N{DEGREE SIGN}", " degrees "),
)


def normalize_spoken_text(text: str, *, locale: str) -> SpokenText:
    """Return one explicit, CTC-safe spoken form for English narration.

    Meaning-bearing math notation is expanded before punctuation is cleaned.
    Any remaining symbol fails closed instead of being silently deleted.
    """

    if not isinstance(text, str) or not text.strip():
        raise SpokenTextError("Narration text must not be empty")
    if not locale.casefold().startswith("en"):
        raise SpokenTextError(
            "The pinned spoken-text contract currently supports English narration"
        )

    value = text.translate(
        {
            ord("\N{SUPERSCRIPT TWO}"): "^2",
            ord("\N{SUPERSCRIPT THREE}"): "^3",
            ord("\N{SUPERSCRIPT FOUR}"): "^4",
            # Publishing tools commonly substitute these for ASCII hyphen-minus.
            # Normalize them before NFKC (which maps the non-breaking form to
            # U+2010) so the existing context-sensitive prose/subtraction rules
            # still decide how the mark is spoken. U+2212 remains an explicit
            # mathematical minus in _SPOKEN_SYMBOLS below.
            ord("\N{HYPHEN}"): "-",
            ord("\N{NON-BREAKING HYPHEN}"): "-",
        }
    )
    value = unicodedata.normalize("NFKC", value)
    value = (
        value.replace("\N{RIGHT SINGLE QUOTATION MARK}", "'")
        .replace("\N{LEFT SINGLE QUOTATION MARK}", "'")
        .replace("\N{EN DASH}", " to ")
        .replace("\N{EM DASH}", ", ")
    )
    value = re.sub(r"\bBig[\s-]*O\b", "Big O", value, flags=re.IGNORECASE)
    value = re.sub(
        r"\bO\s*\(([^()]+)\)",
        lambda match: f"big O of {match.group(1)}",
        value,
    )
    for symbol, phrase in _SPOKEN_SYMBOLS:
        value = value.replace(symbol, phrase)
    value = value.replace("->", " arrow ").replace("=>", " implies ")
    value = re.sub(
        r"\blog\s*_\s*(\d+(?:\.\d+)?)",
        lambda match: f"log base {_number_literal(match.group(1))}",
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(
        r"\b([A-Za-z])\s*_\s*(\d+)\b",
        lambda match: f"{match.group(1)} sub {_integer_words(int(match.group(2)))}",
        value,
    )
    value = re.sub(r"\b([A-Za-z])'(?=\s|[(),.;:!?]|$)", r"\1 prime", value)
    value = re.sub(
        r"(?<!\w)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*[eE]\s*([+-]?\d+)(?!\w)",
        lambda match: f"{_number_literal(match.group(1))} times ten {_power(int(match.group(2)))}",
        value,
    )
    value = re.sub(
        r"\b([A-Za-z]+|(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)"
        r"\s*\^\s*\{?\s*([+-]?\d+(?:\.\d+)?)\s*\}?",
        lambda match: f"{match.group(1)} {_power(match.group(2))} ",
        value,
    )
    value = re.sub(
        r"(?<![\w.])((?:\d{1,3}(?:,\d{3})+|\d+))\s*/\s*((?:\d{1,3}(?:,\d{3})+|\d+))(?!\w)",
        lambda match: (
            f"{_integer_words(int(match.group(1).replace(',', '')))} over "
            f"{_integer_words(int(match.group(2).replace(',', '')))}"
        ),
        value,
    )
    value = re.sub(
        r"(?<!\w)-\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)",
        lambda match: f"minus {_number_literal(match.group(1))}",
        value,
    )
    value = re.sub(r"\s+-\s+", " minus ", value)
    value = re.sub(r"(?<=[)\d])-(?=[A-Za-z\d(])", " minus ", value)
    value = re.sub(r"\b([a-z])-(?=[\d(])", r"\1 minus ", value)
    value = re.sub(r"(?<!\w)-\s*([A-Za-z])\b", r"minus \1", value)
    value = re.sub(
        r"\b([a-z]{1,2})-([a-z]{1,2})\b",
        lambda match: f"{match.group(1)} minus {match.group(2)}",
        value,
    )
    value = re.sub(
        r"(?<=\bminus )([a-z])([a-z])\b",
        lambda match: f"{match.group(1)} {match.group(2)}",
        value,
    )
    value = re.sub(
        r"(?<![\w.])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*%",
        lambda match: f"{_number_literal(match.group(1))} percent",
        value,
    )
    value = re.sub(
        r"(?<![\w.])((?:\d{1,3}(?:,\d{3})+|\d+))(st|nd|rd|th)\b",
        lambda match: _ordinal_words(int(match.group(1).replace(",", ""))),
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(
        r"(?<![\w.])((?:\d{1,3}(?:,\d{3})+|\d+))\s*:\s*"
        r"((?:\d{1,3}(?:,\d{3})+|\d+))(?!\w)",
        lambda match: (
            f"{_number_literal(match.group(1))} to {_number_literal(match.group(2))}"
        ),
        value,
    )
    value = re.sub(
        r"\b([A-Za-z]|(?:\d{1,3}(?:,\d{3})+|\d+))!",
        lambda match: f"{match.group(1)} factorial",
        value,
    )
    value = re.sub(
        r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?",
        lambda match: f" {_number_literal(match.group())} ",
        value,
    )
    replacements = (
        (">=", " greater than or equal to "),
        ("<=", " less than or equal to "),
        ("!=", " not equal to "),
        ("==", " equals "),
        ("+", " plus "),
        ("=", " equals "),
        (">", " greater than "),
        ("<", " less than "),
        ("*", " times "),
        ("/", " divided by "),
        ("&", " and "),
        (")(", ") times ("),
        ("(", " open parenthesis "),
        (")", " close parenthesis "),
        ("-", " "),
    )
    for symbol, phrase in replacements:
        value = value.replace(symbol, phrase)
    value = unicodedata.normalize("NFKD", value)
    value = "".join(character for character in value if not unicodedata.combining(character))
    unsupported = _UNSUPPORTED.search(value)
    if unsupported is not None:
        raise SpokenTextError(
            f"Narration contains unsupported spoken symbol: {unsupported.group()!r}"
        )
    value = re.sub(r"\s+([.,!?;:])", r"\1", value)
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        raise SpokenTextError("Narration has no speakable content")
    return SpokenText(authored_text=text, spoken_text=value)


def _power(exponent: int | str) -> str:
    numeric = str(exponent)
    if numeric == "2":
        return "squared"
    if numeric == "3":
        return "cubed"
    negative = numeric.startswith("-")
    absolute = numeric.removeprefix("-").removeprefix("+")
    value = f"minus {_number_literal(absolute)}" if negative else _number_literal(absolute)
    return f"to the power of {value}"


def _number_literal(value: str) -> str:
    compact = value.replace(",", "")
    if "." not in compact:
        return _integer_words(int(compact))
    integer, fraction = compact.split(".", 1)
    return (
        f"{_integer_words(int(integer))} point {' '.join(_ONES[int(digit)] for digit in fraction)}"
    )


def _integer_words(value: int) -> str:
    if value < 0 or value >= 1_000_000_000_000_000:
        raise SpokenTextError("Narration number is outside the supported spoken range")
    if value < 20:
        return _ONES[value]
    if value < 100:
        tens, remainder = divmod(value, 10)
        return _TENS[tens] if not remainder else f"{_TENS[tens]} {_ONES[remainder]}"
    if value < 1_000:
        hundreds, remainder = divmod(value, 100)
        prefix = f"{_ONES[hundreds]} hundred"
        return prefix if not remainder else f"{prefix} {_integer_words(remainder)}"
    for scale, label in _SCALES:
        if value >= scale:
            quotient, remainder = divmod(value, scale)
            prefix = f"{_integer_words(quotient)} {label}"
            return prefix if not remainder else f"{prefix} {_integer_words(remainder)}"
    raise AssertionError("unreachable integer range")


def _ordinal_words(value: int) -> str:
    cardinal = _integer_words(value)
    prefix, _, final = cardinal.rpartition(" ")
    ordinal = _ORDINALS.get(final, f"{final}th")
    return f"{prefix} {ordinal}" if prefix else ordinal
