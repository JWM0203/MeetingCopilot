"""Dependency-free device selection helpers for the FunASR sidecar."""


def device_candidates(requested: str, torch_module) -> list[str]:
    if requested != "auto":
        return [requested]
    if torch_module.cuda.is_available():
        return ["cuda:0", "cpu"]
    mps = getattr(getattr(torch_module, "backends", None), "mps", None)
    if mps and mps.is_built() and mps.is_available():
        return ["mps", "cpu"]
    return ["cpu"]


def run_with_device_fallback(loader, requested: str, torch_module, on_error=None):
    """Run loader(device), retrying CPU when an automatic accelerator fails."""
    last_error = None
    for device in device_candidates(requested, torch_module):
        try:
            return device, loader(device)
        except Exception as error:  # model/runtime exceptions vary by backend
            last_error = error
            if on_error:
                on_error(device, error)
    if last_error:
        raise last_error
    raise RuntimeError("no FunASR device candidates")
