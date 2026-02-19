"""Problem 1 public tests.
Expected student interface: solve(a: int, b: int) -> int
"""

from solution import solve


def test_add_small_numbers() -> None:
    assert solve(1, 2) == 3


def test_add_negative_numbers() -> None:
    assert solve(-3, 1) == -2
