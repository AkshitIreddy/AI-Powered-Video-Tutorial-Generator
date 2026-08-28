# Binary search: deterministic teaching note

Binary search operates on a sequence sorted in ascending order. Maintain an inclusive candidate interval `[low, high]`. While `low <= high`, choose `mid = low + floor((high-low)/2)`.

- If `values[mid] == target`, return `mid`.
- If `values[mid] < target`, set `low = mid + 1`.
- Otherwise set `high = mid - 1`.

The invariant is: if the target exists, it remains inside `[low, high]`. Every unsuccessful comparison removes `mid` and at least roughly half of the remaining candidates. The loop terminates when the interval is empty. Time complexity is `O(log n)` and iterative auxiliary space is `O(1)`.

## Trace

For `values=[2,5,8,12,16,23,38,56,72,91]` and `target=23`:

1. `[0,9]`, `mid=4`, value `16`; move `low` to `5`.
2. `[5,9]`, `mid=7`, value `56`; move `high` to `6`.
3. `[5,6]`, `mid=5`, value `23`; return index `5`.

For missing target `24`, the interval becomes `[6,6]`, then `[6,5]`; return not found. Empty input begins as `[0,-1]` and performs no array access.
