# Binary search algorithm contract

The discard step is valid only when the searched values are sorted in the order assumed by the comparisons.

If the target exists, each unsuccessful update keeps at least one matching index inside the inclusive interval `[low, high]`.

A complete iterative implementation initializes both bounds, loops while low is at most high, uses a floored midpoint, guards equality and order branches, excludes mid after a miss, and returns not found after the loop.
