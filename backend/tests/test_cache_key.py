from app.chat import _cache_key


def test_cache_key_is_deterministic():
    messages = [{"role": "user", "content": "hello"}]
    assert _cache_key(messages) == _cache_key(messages)


def test_cache_key_differs_for_different_messages():
    a = [{"role": "user", "content": "hello"}]
    b = [{"role": "user", "content": "goodbye"}]
    assert _cache_key(a) != _cache_key(b)
