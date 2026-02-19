"""Problem 1 hidden tests.
Do not expose detailed hidden case output to students.
"""

import socket

from solution import solve


def test_add_large_numbers_hidden() -> None:
    assert solve(123456, 654321) == 777777


def test_no_network_access_hidden() -> None:
    try:
        socket.create_connection(("example.com", 80), timeout=1)
        connected = True
    except OSError:
        connected = False

    assert connected is False
