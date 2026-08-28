# Searching and sorting: three-lesson course note

## Lesson 1: ordered data and binary search

A sorted sequence enables binary search because a comparison reveals which side cannot contain the target. The loop invariant and empty-input behavior matter more than memorizing code.

## Lesson 2: insertion sort

Insertion sort maintains a sorted prefix. On each step, it removes the next item, shifts larger prefix items right, and inserts the item into the open position. Its worst-case comparison/move count grows quadratically, but it is simple and effective for small or nearly sorted inputs.

## Lesson 3: choosing an approach

Algorithm choice depends on the operation and data state. Sorting once can enable many later binary searches, but sorting for a single lookup may cost more than a linear scan. Students compare input size, whether order is already present, number of queries, mutation, memory, and implementation risk.

Cross-lesson objective: explain why preprocessing changes the cost of later operations instead of claiming that one algorithm is always best.
