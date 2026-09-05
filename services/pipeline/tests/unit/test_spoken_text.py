from __future__ import annotations

import pytest

from alystria.generation.spoken_text import SpokenTextError, normalize_spoken_text


@pytest.mark.parametrize(
    ("authored", "spoken"),
    (
        (
            "Big-O is O(n^2): 1,234 + 50% = 1,851.",
            "Big O is big O of n squared: one thousand two hundred thirty four plus "
            "fifty percent equals one thousand eight hundred fifty one.",
        ),
        (
            "For x^3 >= 2.5, use theta(n log_2 n) <= 3/4.",
            "For x cubed greater than or equal to two point five, use theta open "
            "parenthesis n log base two n close parenthesis less than or equal to "
            "three over four.",
        ),
        (
            "H2O at -12 degrees C approaches 0; delta x -> infinity.",
            "H two O at minus twelve degrees C approaches zero; delta x arrow infinity.",
        ),
        (
            "1.2e-3 * 2^10 \N{ALMOST EQUAL TO} \N{SQUARE ROOT}16, and "
            "\N{GREEK SMALL LETTER ALPHA} \N{ELEMENT OF} A \N{UNION} B.",
            "one point two times ten to the power of minus three times two to the power "
            "of ten approximately square root of sixteen, and alpha is an element of A "
            "union B.",
        ),
        (
            "Karatsuba uses (a+b)(c+d)-ac-bd, then n-1 in divide-and-conquer.",
            "Karatsuba uses open parenthesis a plus b close parenthesis times open "
            "parenthesis c plus d close parenthesis minus a c minus b d, then n minus "
            "one in divide and conquer.",
        ),
        (
            "Karatsuba is divide\N{HYPHEN}and\N{HYPHEN}conquer: for n\N{NON-BREAKING HYPHEN}1, "
            "compute (a+b)(c+d)\N{HYPHEN}ac\N{NON-BREAKING HYPHEN}bd.",
            "Karatsuba is divide and conquer: for n minus one, compute open parenthesis "
            "a plus b close parenthesis times open parenthesis c plus d close parenthesis "
            "minus a c minus b d.",
        ),
        (
            "Karatsuba is O(n^1.585), versus O(n^2).",
            "Karatsuba is big O of n to the power of one point five eight five, "
            "versus big O of n squared.",
        ),
        (
            "Karatsuba expands (a+b)(c+d) \N{EN DASH} ac \N{EN DASH} bd = ad + bc.",
            "Karatsuba expands open parenthesis a plus b close parenthesis times open "
            "parenthesis c plus d close parenthesis minus a c minus b d equals a d plus b c.",
        ),
        (
            "Pages 3\N{EN DASH}5 cover ages 10\N{EN DASH}12, from 2020 \N{EN DASH} 2024.",
            "Pages three to five cover ages ten to twelve, from two thousand twenty to "
            "two thousand twenty four.",
        ),
        (
            "Compute 5.0 \N{EN DASH} 3.0 before the n\N{EN DASH}1 step.",
            "Compute five point zero minus three point zero before the n minus one step.",
        ),
        (
            "The middle product \N{EN DASH} our key saving \N{EN DASH} replaces a fourth call.",
            "The middle product, our key saving, replaces a fourth call.",
        ),
        (
            "I \N{EN DASH} a teacher \N{EN DASH} use this example, and we "
            "\N{EN DASH} a small team \N{EN DASH} check it together.",
            "I, a teacher, use this example, and we, a small team, check it together.",
        ),
        (
            "We start small, so \N{EN DASH} an example with four digits comes first.",
            "We start small, so, an example with four digits comes first.",
        ),
        (
            "Call this \N{LEFT DOUBLE QUOTATION MARK}three\N{HYPHEN}product multiplication"
            "\N{RIGHT DOUBLE QUOTATION MARK}: 12 \N{MULTIPLICATION SIGN} 34 = 408.",
            'Call this "three product multiplication": twelve times thirty four equals '
            "four hundred eight.",
        ),
        (
            "SHA-256 and H2O use UTF-8; Bézout's f'(x_1) = 5! at ratio 1:2.",
            "SHA two hundred fifty six and H two O use UTF eight; Bezout's f prime open "
            "parenthesis x sub one close parenthesis equals five factorial at ratio one to two.",
        ),
    ),
)
def test_math_narration_has_one_explicit_ctc_safe_spoken_form(authored: str, spoken: str) -> None:
    result = normalize_spoken_text(authored, locale="en-US")

    assert result.authored_text == authored
    assert result.spoken_text == spoken
    assert not any(character.isdigit() for character in result.spoken_text)


def test_spoken_text_rejects_unsupported_semantic_symbols_instead_of_dropping_them() -> None:
    with pytest.raises(SpokenTextError, match="unsupported spoken symbol"):
        normalize_spoken_text("Compute x ⊗ y.", locale="en-US")

    with pytest.raises(SpokenTextError, match="unsupported spoken symbol"):
        normalize_spoken_text("Compute x | y.", locale="en-US")


def test_spoken_text_rejects_an_ambiguous_en_dash_instead_of_guessing() -> None:
    with pytest.raises(SpokenTextError, match="ambiguous en dash"):
        normalize_spoken_text("Compare revenue \N{EN DASH} cost before taxes.", locale="en-US")

    with pytest.raises(SpokenTextError, match="ambiguous en dash"):
        normalize_spoken_text("The bare value is 5\N{EN DASH}3.", locale="en-US")


def test_spoken_text_rejects_non_english_locale_for_english_ctc_contract() -> None:
    with pytest.raises(SpokenTextError, match="English"):
        normalize_spoken_text("La valeur est 12.", locale="fr-FR")
