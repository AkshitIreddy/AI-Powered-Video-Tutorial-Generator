# Binary-search tutorial content review

Status: repaired in the canonical fixture and generation pipeline on 2026-08-29.

This review covers the rejected run at
`Alystria Studio Test Area/Test Data/full-real-e2e/runs/20260829T184002Z` and
defines the release-blocking teaching contract for its replacement.

## Rejected-run findings

| Area | Rejected content | Required correction |
| --- | --- | --- |
| Pseudocode | The displayed fragment omitted initialization, conditional guards, a floored midpoint, and the not-found return. It could be read as an unconditional return followed by unreachable updates. | Show the complete iterative loop, including `low = 0`, `high = length(values) - 1`, `while low <= high`, guarded equality/order branches, `mid = low + floor((high - low) / 2)`, boundary updates that exclude `mid`, and `return NOT_FOUND` after the loop. |
| Found trace | Target 44 was found at index 6, but the visual then presented `[6,6]` as though the bounds had changed after equality. | Return immediately from the actual candidate interval `[5,8]`. Do not append a boundary update or another state after the match. |
| Absent case | Absence was described but not executed as a complete state trace. | For target 50 in `[3,8,12,17,23,31,44,58,72]`, show midpoint indices 4, 6, and 7, followed by terminal bounds `[7,6]` and `NOT_FOUND`. |
| 1,024-value bound | “Ten comparisons” conflated halvings with value probes. | State that ten halvings reduce 1,024 candidates to one candidate, which still needs to be probed. The worst case is therefore up to 11 value probes. |
| Retrieval practice | The quiz answer appeared with the prompt. | Put the question and unselected choices in one scene; reveal and explain “No” only in the following scene. |
| Captions | SRT/VTT offsets accumulated raw synthesis durations rather than authored scene durations. | Offset each scene's local word timings by the cumulative storyboard duration. The renderer and both sidecars must share the same scene clock. |

## Timing evidence from the rejected run

The rendered scenes began at 0, 24, 42, 69, 84, 106, 124, and 146 seconds.
The corresponding SRT/VTT narration groups began at 0, 23.224, 42.258,
76.842, 95.562, 116.902, 139.046, and 167.430 seconds. The drift therefore
reached 21.430 seconds by the final scene. The media ended at 160.008 seconds,
while the sidecars continued to 176.045 seconds.

The repaired fixture has nine 20-second scenes. Its authored starts are 0, 20,
40, 60, 80, 100, 120, 140, and 160 seconds. Raw narration may end before a
scene does, but it must not pull the next scene's captions earlier.

## Exact content contract

The canonical values are `[3,8,12,17,23,31,44,58,72]`.

### Complete iterative pseudocode

```text
low = 0
high = length(values) - 1

while low <= high:
    mid = low + floor((high - low) / 2)
    if values[mid] == target:
        return mid
    if values[mid] < target:
        low = mid + 1
    else:
        high = mid - 1

return NOT_FOUND
```

### Target 44

| low | mid | high | value | action |
| ---: | ---: | ---: | ---: | --- |
| 0 | 4 | 8 | 23 | `low = 5` |
| 5 | 6 | 8 | 44 | `return 6` |

The final row is the return state. Its bounds remain `[5,8]`.

### Absent target 50

| low | mid | high | value | action |
| ---: | ---: | ---: | ---: | --- |
| 0 | 4 | 8 | 23 | `low = 5` |
| 5 | 6 | 8 | 44 | `low = 7` |
| 7 | 7 | 8 | 58 | `high = 6` |

Now `low > high`, so the result is `NOT_FOUND`. Empty input similarly begins
with bounds `[0,-1]` and performs no element access.

## Pedagogy and pacing acceptance

- State the sorted-input prerequisite before the first discard step.
- Name the invariant and keep low, mid, high, compared value, and action visible
  together during both traces.
- Reserve “comparison” for a defined unit. This lesson uses “value probe” for
  one inspected midpoint, avoiding ambiguity about equality and order operators.
- Keep the question scene answer-neutral. Its narration, captions, selected
  state, and explanation must not reveal the correct choice.
- Use the separate reveal scene to explain why sorted order justifies discarding
  one side.
- End with a recap that retrieves the prerequisite, interval rule, equality
  return, miss updates, absent termination, and 11-probe bound.
- During review, calculate words per minute from the authored narration window,
  inspect both orientations, and verify that no caption crosses the final media
  boundary.

## Authoritative cross-checks

- The US National Institute of Standards and Technology describes binary search
  as searching a sorted array by repeatedly halving the search interval and
  gives logarithmic complexity:
  <https://xlinux.nist.gov/dads/HTML/binarySearch.html>.
- Princeton's Algorithms library requires keys in increasing order and returns
  an index on success or `-1` on failure:
  <https://algs4.cs.princeton.edu/code/javadoc/edu/princeton/cs/algs4/BinarySearch.html>.
- Open Data Structures derives `log(n) + 1` as the maximum comparison/probe
  depth for binary search, which makes the 1,024-value worst case 11:
  <https://opendatastructures.org/ods-java/1_3_Mathematical_Background.html>.
- Oracle's Java API likewise specifies that the array must be sorted before a
  binary search and defines a negative result for an absent key:
  <https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/util/Arrays.html>.

## Release checklist

- `fixtures/validate.py` passes.
- The source SHA-256 in the fixture matches the checked-in teaching note.
- Executing the fixture's exact found and absent traces matches every asserted
  state and result.
- The prompt scene immediately precedes a separate reveal scene.
- The generated storyboard preserves the authored fixture scene IDs and text.
- A deliberately short narration clip in scene one does not shift scene two's
  SRT or VTT start before the authored scene boundary.
