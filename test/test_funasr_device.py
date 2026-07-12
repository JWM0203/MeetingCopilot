import unittest

from tools.funasr_device import device_candidates, run_with_device_fallback


class _Flag:
    def __init__(self, value):
        self.value = value

    def is_available(self):
        return self.value

    def is_built(self):
        return self.value


class _Torch:
    def __init__(self, cuda=False, mps=False):
        self.cuda = _Flag(cuda)
        self.backends = type("Backends", (), {"mps": _Flag(mps)})()


class FunasrDeviceTest(unittest.TestCase):
    def test_auto_order_is_cuda_then_mps_then_cpu(self):
        self.assertEqual(device_candidates("auto", _Torch(cuda=True, mps=True)), ["cuda:0", "cpu"])
        self.assertEqual(device_candidates("auto", _Torch(mps=True)), ["mps", "cpu"])
        self.assertEqual(device_candidates("auto", _Torch()), ["cpu"])

    def test_explicit_device_is_not_rewritten(self):
        self.assertEqual(device_candidates("cpu", _Torch(mps=True)), ["cpu"])

    def test_failed_mps_initialization_retries_on_cpu(self):
        calls = []

        def load(device):
            calls.append(device)
            if device == "mps":
                raise RuntimeError("MPS unavailable")
            return "loaded"

        device, result = run_with_device_fallback(load, "auto", _Torch(mps=True))
        self.assertEqual((device, result), ("cpu", "loaded"))
        self.assertEqual(calls, ["mps", "cpu"])


if __name__ == "__main__":
    unittest.main()
