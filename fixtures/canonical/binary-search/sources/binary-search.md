# Binary search: deterministic teaching note

## Contract and prerequisite

Binary search requires values sorted in ascending order. It maintains an
inclusive candidate interval `[low, high]`. The loop invariant is: if the target
exists, at least one matching index remains inside `[low, high]`. The algorithm
must not discard a side on unsorted input because the comparison would not tell
which side can safely be removed.

## Complete iterative pseudocode

```text
low = 0; high = length(values) - 1
while low <= high do
    mid = low + floor((high - low) / 2)
    if values[mid] == target then return mid
    if values[mid] < target then low = mid + 1
    else high = mid - 1
end while
return NOT_FOUND
```

The equality branch returns immediately. Only an unsuccessful comparison
updates an interval boundary, and the update excludes `mid`. The final return is
outside the loop and handles the empty interval. Empty input starts with
`low = 0` and `high = -1`, so the loop performs no array access.

## Found trace: target 44

For `values = [3, 8, 12, 17, 23, 31, 44, 58, 72]` and `target = 44`:

1. The candidate interval is `[0,8]`. `mid = 4`, value `23`; set `low = 5`.
2. The candidate interval is `[5,8]`. `mid = 6`, value `44`; return index `6`.

The return happens while the inclusive candidate interval is still `[5,8]`.
`[6,6]` is not an algorithm state in this execution because the equality branch
does not update `low` or `high` before returning.

## Missing trace: target 50

Using the same sorted values and `target = 50`:

1. `[0,8]`, `mid = 4`, value `23`; set `low = 5`.
2. `[5,8]`, `mid = 6`, value `44`; set `low = 7`.
3. `[7,8]`, `mid = 7`, value `58`; set `high = 6`.
4. The interval is empty because `low = 7` and `high = 6`; return `NOT_FOUND`.

## Comparison bound and complexity

Each unsuccessful probe reduces the inclusive candidate interval to at most
half its previous size. For 1,024 sorted values, ten halvings reduce 1,024
candidates to one candidate, but that final candidate still has to be probed.
Therefore a successful or unsuccessful search can require up to 11 value probes
in the worst case. In general, a non-empty input of length `n` needs at most
`floor(log2(n)) + 1`, equivalently `ceil(log2(n + 1))`, value probes. Iterative
binary search takes `O(log n)` time and `O(1)` auxiliary space; a linear scan can
take up to `n` value probes.

## Retrieval check

Question: can ordinary binary search safely discard half of an unsorted array?
Pause before revealing the answer. Answer: no. Sorting is the evidence that a
comparison eliminates one side; without it, the target could be anywhere.

## Grounded release claims

The discard step is valid only when the searched values are sorted in the order
assumed by the comparisons.

If the target exists, each unsuccessful update keeps at least one matching index
inside the inclusive interval `[low, high]`.

A complete iterative implementation initializes both bounds, loops while low is
at most high, uses a floored midpoint, guards equality and order branches,
excludes mid after a miss, and returns not found after the loop.

For `[3,8,12,17,23,31,44,58,72]`, target 44 is found at index 6 from interval
`[5,8]` after probes at indices 4 and 6.

For the same values, absent target 50 probes indices 4, 6, and 7, then
terminates with low 7 and high 6.

For 1,024 values, ten halvings leave one candidate and the worst case uses up
to 11 value probes.

Iterative binary search uses `O(log n)` time and `O(1)` auxiliary space, while
linear scan can use `O(n)` time.
