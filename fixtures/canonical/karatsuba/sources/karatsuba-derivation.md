# Karatsuba multiplication: deterministic teaching note

Let a base-ten integer be split at `m` digits:

`x = a × 10^m + b` and `y = c × 10^m + d`.

Direct expansion is

`xy = ac × 10^(2m) + (ad + bc) × 10^m + bd`.

Define three recursive products:

- `z2 = ac`
- `z0 = bd`
- `p = (a + b)(c + d)`

Because `p = ac + ad + bc + bd`, the middle coefficient is

`z1 = p − z2 − z0 = ad + bc`.

Therefore

`xy = z2 × 10^(2m) + z1 × 10^m + z0`.

## Worked example: 1234 × 5678

Split at two digits: `a=12`, `b=34`, `c=56`, `d=78`, and `10^m=100`.

- `z2 = 12 × 56 = 672`
- `z0 = 34 × 78 = 2652`
- `p = 46 × 134 = 6164`
- `z1 = 6164 − 672 − 2652 = 2840`

Recombine:

`672 × 10000 + 2840 × 100 + 2652 = 6,720,000 + 284,000 + 2,652 = 7,006,652`.

The recurrence for equal-sized operands is `T(n)=3T(n/2)+O(n)`, giving `O(n^(log2 3))`, approximately `O(n^1.585)`, compared with grade-school `O(n^2)` single-digit multiplications.

This note is locally authored test material. Reviewer context: Karatsuba and Ofman's original 1962 result is discussed in standard algorithms literature; the fixture does not require network access.
