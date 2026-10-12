import io
import json
import sys
import traceback


MAX_REQUEST_BYTES = 512 * 1024
request = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
if len(request) > MAX_REQUEST_BYTES:
    print("Compiler request exceeded the runner input limit.", file=sys.stderr)
    raise SystemExit(1)

try:
    payload = json.loads(request)
    code = payload["code"]
    program_input = payload["stdin"]
    if not isinstance(code, str) or not isinstance(program_input, str):
        raise ValueError("Code and program input must be text.")
except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
    print(f"Invalid compiler request: {error}", file=sys.stderr)
    raise SystemExit(1)

sys.stdin = io.StringIO(program_input)
namespace = {"__name__": "__main__", "__file__": "<student>"}

try:
    compiled = compile(code, "<student>", "exec")
    exec(compiled, namespace)
except SystemExit as error:
    if error.code is None:
        raise SystemExit(0)
    if isinstance(error.code, int):
        raise SystemExit(error.code)
    print(error.code, file=sys.stderr)
    raise SystemExit(1)
except BaseException:
    traceback.print_exc()
    raise SystemExit(1)
