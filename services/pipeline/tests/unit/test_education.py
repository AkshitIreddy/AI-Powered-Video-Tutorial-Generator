from __future__ import annotations

import unittest

from alystria.research import (
    DeterministicOfflineProvider,
    EducationalWorkflow,
    ExperienceLevel,
    GroundingMode,
    LearnerProfile,
    LearningObjective,
    Misconception,
    ObjectiveLevel,
    Prerequisite,
    PrerequisiteDag,
    ReviewDimension,
)


class EducationTests(unittest.TestCase):
    def test_prerequisite_dag_orders_dependencies_and_rejects_cycle(self) -> None:
        numbers = Prerequisite.create("Place value")
        multiplication = Prerequisite.create("Multiplication")
        recursion = Prerequisite.create("Recursion")
        dag = PrerequisiteDag(
            [numbers, multiplication, recursion],
            [(numbers.id, multiplication.id), (multiplication.id, recursion.id)],
        )
        order = dag.topological_order()
        self.assertLess(order.index(numbers.id), order.index(recursion.id))
        with self.assertRaises(ValueError):
            PrerequisiteDag(
                [numbers, multiplication],
                [(numbers.id, multiplication.id), (multiplication.id, numbers.id)],
            )

    def test_plan_requires_every_objective_in_outline(self) -> None:
        provider = DeterministicOfflineProvider()
        workflow = EducationalWorkflow(provider)
        learner = LearnerProfile(
            "undergraduate computer science students",
            ExperienceLevel.INTERMEDIATE,
            goals=("analyze complexity",),
        )
        objective = LearningObjective.create(
            "Explain why Karatsuba needs only three recursive multiplications.",
            level=ObjectiveLevel.ANALYZE,
            assessment="Derive the cross term.",
            claim_ids=("claim_karatsuba",),
        )
        plan = workflow.create_plan(
            topic="Karatsuba multiplication",
            learner=learner,
            objectives=[objective],
            prerequisites=PrerequisiteDag([Prerequisite.create("Polynomial multiplication")]),
            misconceptions=[Misconception.create(
                "Karatsuba performs four multiplications.",
                "The cross term is recovered from three products.",
                "How many recursive products are computed?",
            )],
            target_duration_seconds=720,
        )
        self.assertEqual(plan.outline[0].objective_ids, (objective.id,))
        self.assertEqual(plan.target_duration_seconds, 720)

    def test_offline_multi_pass_workflow_is_deterministic_and_runs_all_reviews(self) -> None:
        workflow = EducationalWorkflow(DeterministicOfflineProvider())
        learner = LearnerProfile("adult beginners", ExperienceLevel.BEGINNER)
        objective = LearningObjective.create(
            "Apply binary search to a sorted list.",
            claim_ids=("claim_binary_search",),
        )
        plan = workflow.create_plan(
            topic="Binary search",
            learner=learner,
            objectives=[objective],
            prerequisites=PrerequisiteDag([Prerequisite.create("Sorted lists")]),
            target_duration_seconds=180,
        )
        first = workflow.create_script(plan, grounding=GroundingMode.GROUNDED)
        second = workflow.create_script(plan, grounding=GroundingMode.GROUNDED)
        self.assertEqual(first, second)
        self.assertEqual(
            tuple(review.dimension for review in first.reviews),
            EducationalWorkflow.DEFAULT_PASSES,
        )
        self.assertEqual(first.final.revision, 1 + len(EducationalWorkflow.DEFAULT_PASSES))
        self.assertIn(ReviewDimension.PACING.value, first.final.metadata["reviewed"])
        self.assertGreater(first.final.word_count, 0)


if __name__ == "__main__":
    unittest.main()
