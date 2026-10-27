import base64
import io
import json
import sys
import traceback
from contextlib import redirect_stderr, redirect_stdout


MAX_REQUEST_BYTES = 512 * 1024
MAX_CAPTURED_TEXT_CHARS = 32 * 1024
MAX_PLOTS = 4
MAX_PLOT_BYTES = 256 * 1024
MAX_TOTAL_PLOT_BYTES = 768 * 1024
RESULT_PREFIX = "DSLAB_EXECUTION_RESULT:"
encode_result = json.dumps
protocol_stdout = sys.__stdout__


class LimitedTextBuffer(io.TextIOBase):
    def __init__(self, limit):
        self.limit = limit
        self.parts = []
        self.length = 0
        self.truncated = False

    def write(self, text):
        remaining = self.limit - self.length
        if remaining > 0:
            kept = text[:remaining]
            self.parts.append(kept)
            self.length += len(kept)
        if len(text) > remaining:
            self.truncated = True
        return len(text)

    def getvalue(self):
        value = "".join(self.parts)
        if self.truncated:
            value += "\n[Output truncated at 32 KB.]"
        return value


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
stdout = LimitedTextBuffer(MAX_CAPTURED_TEXT_CHARS)
stderr = LimitedTextBuffer(MAX_CAPTURED_TEXT_CHARS)
result = {
    "ok": False,
    "status": "runtime-error",
    "detail": "Runtime Error",
    "exitCode": 1,
    "compileOutput": "",
    "compileError": "",
    "stdout": "",
    "stderr": "",
    "plots": [],
}

with redirect_stdout(stdout), redirect_stderr(stderr):
    try:
        compiled = compile(code, "<student>", "exec")
        exec(compiled, namespace)
        result.update(ok=True, status="success", detail="Execution completed", exitCode=0)
    except SyntaxError:
        result.update(status="compile-error", detail="Syntax Error")
        traceback.print_exc(file=stderr)
    except SystemExit as error:
        if error.code is None or error.code == 0:
            result.update(ok=True, status="success", detail="Execution completed", exitCode=0)
        else:
            result.update(detail="Program exited with an error")
            if isinstance(error.code, int):
                result["exitCode"] = error.code
            else:
                print(error.code, file=stderr)
    except BaseException:
        traceback.print_exc(file=stderr)

result["stdout"] = stdout.getvalue()
result["stderr"] = stderr.getvalue()
if result["status"] == "compile-error":
    result["compileError"] = result["stderr"]
    result["stderr"] = ""

try:
    import matplotlib.pyplot as pyplot

    total_plot_bytes = 0
    for number in pyplot.get_fignums()[:MAX_PLOTS]:
        figure = pyplot.figure(number)
        width, height = figure.get_size_inches()
        scale = min(1, 12 / max(width, height))
        if scale < 1:
            figure.set_size_inches(width * scale, height * scale)
        image = io.BytesIO()
        figure.savefig(image, format="png", dpi=80)
        plot = image.getvalue()
        if len(plot) > MAX_PLOT_BYTES or total_plot_bytes + len(plot) > MAX_TOTAL_PLOT_BYTES:
            result["stderr"] = (result["stderr"] + "\nA generated plot was omitted because it exceeded the image size limit.").strip()
            continue
        result["plots"].append(base64.b64encode(plot).decode("ascii"))
        total_plot_bytes += len(plot)
    if len(pyplot.get_fignums()) > MAX_PLOTS:
        result["stderr"] = (result["stderr"] + "\nOnly the first four generated plots are shown.").strip()
except Exception as error:
    result["stderr"] = (result["stderr"] + f"\nCould not render generated plots: {error}").strip()

protocol_stdout.write(RESULT_PREFIX + encode_result(result, separators=(",", ":")) + "\n")
